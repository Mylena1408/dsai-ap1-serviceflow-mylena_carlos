import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createHoliday, deleteHoliday, getCalendarOverview, loadBusinessCalendar, updateCalendar } from "@/modules/calendar";
import {
  changeRequestPriority,
  createRequest,
  decideApproval,
  reopenRequest,
  transitionRequestStatus,
} from "@/modules/requests";
import { slaScheduleAfterPriorityChange, slaScheduleFrom } from "@/modules/requests/domain/sla";
import { createService, updateService } from "@/modules/services";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { clockTimeBetween, type SlaClock } from "@/shared/business-clock";

// SPEC 2026-11-03-pausa-sla-calendario, 5.1, 5.2 and 5.9 over the database (SF-129; CA-PSL-02 to 04).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });

async function businessClock(): Promise<SlaClock> {
  return { kind: "business", calendar: await loadBusinessCalendar(prisma) };
}

/** One business hour a day, 10:00 to 11:00 UTC, every day: business time is easy to see. */
const narrowCalendar = { weekdays: ["1", "2", "3", "4", "5", "6", "7"], startTime: "10:00", endTime: "11:00", timeZone: "UTC" };

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  actAs(admin);
  await updateCalendar(narrowCalendar, prisma);
  const base = { description: "Reparo", categoryId: category.id, sectorId: sector.id, slaHours: "1" };
  const business = await createService({ name: `Úteis ${sector.id}`, ...base, slaBusinessHours: true }, prisma);
  const calendar = await createService({ name: `Corridas ${sector.id}`, ...base }, prisma);
  const approval = await createService({ name: `Aprovação ${sector.id}`, ...base, slaBusinessHours: true, requiresApproval: true }, prisma);
  return { admin, rita, ana, gabi, base, business, calendar, approval };
}

describe("business calendar in the administration (SF-129)", () => {
  it("starts with the default, saves the settings and audits each change (CA-PSL-02)", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    actAs(admin);

    await expect(getCalendarOverview(prisma)).resolves.toEqual({
      settings: { weekdays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1080, timeZone: "America/Sao_Paulo", updatedAt: null },
      holidays: [],
    });

    await updateCalendar({ weekdays: ["1", "2", "3", "4", "5", "6"], startTime: "08:00", endTime: "12:00", timeZone: "America/Belem" }, prisma);
    const { id } = await createHoliday({ day: "2026-12-25", name: "Natal", yearly: true }, prisma);
    await expect(createHoliday({ day: "2026-12-25", name: "Outro", yearly: false }, prisma)).rejects.toThrow(ConflictError);

    const overview = await getCalendarOverview(prisma);
    expect(overview.settings).toMatchObject({ weekdays: [1, 2, 3, 4, 5, 6], startMinute: 480, endMinute: 720, timeZone: "America/Belem" });
    expect(overview.holidays).toMatchObject([{ id, day: "2026-12-25", name: "Natal", yearly: true }]);

    await deleteHoliday({ holidayId: id }, prisma);
    await expect(deleteHoliday({ holidayId: id }, prisma)).rejects.toThrow(NotFoundError);
    await expect(prisma.businessHoliday.count()).resolves.toBe(0);

    const entries = await prisma.auditEntry.findMany({
      where: { entityType: { in: ["BUSINESS_CALENDAR", "HOLIDAY"] } },
      orderBy: { occurredAt: "asc" },
      select: { action: true, entityType: true, entityLabel: true, changes: true, actorId: true },
    });
    expect(entries).toEqual([
      {
        action: "UPDATED",
        entityType: "BUSINESS_CALENDAR",
        entityLabel: "Calendário",
        actorId: admin.id,
        // Only what changed from the default.
        changes: [
          {
            field: "weekdays",
            before: ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"],
            after: ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"],
          },
          { field: "endTime", before: "18:00", after: "12:00" },
          { field: "timeZone", before: "America/Sao_Paulo", after: "America/Belem" },
        ],
      },
      {
        action: "CREATED",
        entityType: "HOLIDAY",
        entityLabel: "Natal",
        actorId: admin.id,
        changes: [
          { field: "day", before: null, after: "2026-12-25" },
          { field: "name", before: null, after: "Natal" },
          { field: "yearly", before: null, after: true },
        ],
      },
      {
        action: "DELETED",
        entityType: "HOLIDAY",
        entityLabel: "Natal",
        actorId: admin.id,
        changes: [
          { field: "day", before: "2026-12-25", after: null },
          { field: "name", before: "Natal", after: null },
          { field: "yearly", before: true, after: null },
        ],
      },
    ]);
  });

  it("refuses invalid settings and other profiles (CA-PSL-02)", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: (await createDomainSector()).id });
    actAs(admin);

    for (const input of [
      { ...narrowCalendar, weekdays: [] },
      { ...narrowCalendar, startTime: "11:00", endTime: "10:00" },
      { ...narrowCalendar, timeZone: "Lua/Base" },
    ]) {
      await expect(updateCalendar(input, prisma), JSON.stringify(input)).rejects.toThrow(ValidationError);
    }
    await expect(createHoliday({ day: "2026-02-30", name: "Nada", yearly: false }, prisma)).rejects.toThrow(ValidationError);
    await expect(createHoliday({ day: "2026-12-24", name: "  ", yearly: false }, prisma)).rejects.toThrow(ValidationError);

    actAs(ana);
    await expect(updateCalendar(narrowCalendar, prisma)).rejects.toThrow(AuthorizationError);
    await expect(createHoliday({ day: "2026-12-24", name: "Véspera", yearly: false }, prisma)).rejects.toThrow(AuthorizationError);
    await expect(getCalendarOverview(prisma)).rejects.toThrow(AuthorizationError);
    await expect(prisma.businessCalendar.count()).resolves.toBe(0);
  });
});

describe("business hours in the SLA calculations (SF-129)", () => {
  it("opens with the service's clock and writes 'due soon' in business hours (CA-PSL-03)", async () => {
    const { rita, business, calendar } = await scenario();
    actAs(rita);

    const inBusiness = await stored((await createRequest({ serviceId: business.id, description: "Tomada" }, prisma)).id);
    const expected = slaScheduleFrom(inBusiness.createdAt, 1, "NORMAL", await businessClock())!;
    expect(inBusiness).toMatchObject({ slaBusinessHours: true, dueAt: expected.dueAt, dueSoonAt: expected.dueSoonAt });
    // One business hour a day: the due date is the end of a window, 11:00 UTC.
    expect(inBusiness.dueAt!.toISOString().slice(11)).toBe("11:00:00.000Z");
    expect(clockTimeBetween(inBusiness.createdAt, inBusiness.dueAt!, await businessClock())).toBe(HOUR);

    // Calendar hours work as before: the trigger fills "due soon".
    const inCalendar = await stored((await createRequest({ serviceId: calendar.id, description: "Tomada" }, prisma)).id);
    expect(inCalendar).toMatchObject({ slaBusinessHours: false });
    expect(inCalendar.dueAt!.getTime() - inCalendar.createdAt.getTime()).toBe(HOUR);
    expect(inCalendar.dueAt!.getTime() - inCalendar.dueSoonAt!.getTime()).toBe(12 * 60 * 1000);
  });

  it("keeps stored due dates when the calendar or the service changes (CA-PSL-04)", async () => {
    const { admin, rita, base, business } = await scenario();
    actAs(rita);
    const request = await stored((await createRequest({ serviceId: business.id, description: "Tomada" }, prisma)).id);

    actAs(admin);
    await updateCalendar({ ...narrowCalendar, startTime: "00:00", endTime: "24:00" }, prisma);
    await createHoliday({ day: request.dueAt!.toISOString().slice(0, 10), name: "Ponto facultativo", yearly: false }, prisma);
    await updateService(business.id, { name: business.name, ...base, slaBusinessHours: false }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({ slaBusinessHours: true, dueAt: request.dueAt, dueSoonAt: request.dueSoonAt });
  });

  it("recalculates on approval, priority change and reopening with the request's clock (CA-PSL-03)", async () => {
    const { rita, ana, gabi, approval } = await scenario();
    actAs(rita);
    const { id } = await createRequest({ serviceId: approval.id, description: "Notebook" }, prisma);
    await expect(stored(id)).resolves.toMatchObject({ slaBusinessHours: true, dueAt: null, dueSoonAt: null });

    actAs(gabi);
    await decideApproval({ requestId: id, decision: "APPROVED" }, prisma);
    const approved = await stored(id);
    const decision = await prisma.requestApproval.findUniqueOrThrow({ where: { requestId: id } });
    expect(approved).toMatchObject(slaScheduleFrom(decision.decidedAt, 1, "NORMAL", await businessClock())!);

    actAs(ana);
    await transitionRequestStatus({ requestId: id, toStatus: "IN_PROGRESS" }, prisma);
    await changeRequestPriority({ requestId: id, priority: "LOW" }, prisma);
    const low = slaScheduleAfterPriorityChange(approved.dueAt, 1, "NORMAL", "LOW", await businessClock())!;
    await expect(stored(id)).resolves.toMatchObject({ priority: "LOW", dueAt: low.dueAt, dueSoonAt: low.dueSoonAt });
    // Two business hours from the approval: two windows.
    expect(clockTimeBetween(decision.decidedAt, low.dueAt, await businessClock())).toBe(2 * HOUR);

    await transitionRequestStatus({ requestId: id, toStatus: "COMPLETED" }, prisma);
    actAs(rita);
    await reopenRequest({ requestId: id, note: "Voltou a falhar" }, prisma);
    const reopened = await stored(id);
    expect(reopened).toMatchObject(slaScheduleFrom(reopened.updatedAt, 1, "LOW", await businessClock())!);
  });
});
