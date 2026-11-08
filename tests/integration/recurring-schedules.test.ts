import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { addDays } from "@/shared/time";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 5.3 items 1, 2 and 4 (SF-185; CA-REC-02 and 05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  MAX_ACTIVE_SCHEDULES,
  changeScheduleState,
  createSchedule,
  listScheduleOverview,
  listScheduleServiceFields,
  updateSchedule,
} from "@/modules/recurring-requests";
import { FieldAnswersError } from "@/modules/service-fields";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function scenario() {
  const maintenance = await createDomainSector();
  const ti = await createDomainSector();
  const category = await createDomainCategory();
  const air = await createDomainService({ categoryId: category.id, sectorId: maintenance.id });
  const laptop = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const room = await prisma.serviceField.create({
    data: { serviceId: air.id, label: "Sala", type: "SHORT_TEXT", isRequired: true, options: [], position: 1 },
  });
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: maintenance.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: maintenance.id });
  const today = await organizationToday(prisma);
  const input = {
    name: "Limpeza do ar",
    serviceId: air.id,
    requesterId: rita.id,
    description: "Limpeza preventiva dos filtros",
    answers: { [room.id]: "Sala 12" },
    frequency: "WEEKLY",
    weekdays: ["1", "4"],
    startsOn: today,
  };
  return { maintenance, ti, air, laptop, room, admin, gabi, rita, ana, today, input };
}

describe("who manages the schedules (5.3 item 1; CA-REC-02)", () => {
  it("the administrator for any service, a manager only for the services of their sector", async () => {
    const { admin, gabi, ana, rita, air, laptop, input } = await scenario();

    actAs(gabi);
    const { id } = await createSchedule(input, prisma);
    await expect(createSchedule({ ...input, serviceId: laptop.id, answers: {} }, prisma)).rejects.toBeInstanceOf(NotFoundError);

    for (const other of [ana, rita]) {
      actAs(other);
      await expect(createSchedule(input, prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listScheduleOverview(prisma)).rejects.toBeInstanceOf(AuthorizationError);
    }

    actAs(admin);
    await createSchedule({ ...input, serviceId: laptop.id, answers: {}, name: "Troca de notebook" }, prisma);
    expect((await listScheduleOverview(prisma)).schedules.map(({ name }) => name)).toEqual(["Limpeza do ar", "Troca de notebook"]);

    // The manager sees only the schedules and services of their sector.
    actAs(gabi);
    const overview = await listScheduleOverview(prisma);
    expect(overview.schedules.map((schedule) => schedule.id)).toEqual([id]);
    expect(overview.services.map((service) => service.id)).toEqual([air.id]);
    await expect(listScheduleServiceFields(laptop.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("every change goes to the audit trail, with the description and the answers as personal data", async () => {
    const { gabi, input } = await scenario();
    actAs(gabi);
    const { id } = await createSchedule(input, prisma);
    await updateSchedule(id, { ...input, frequency: "MONTHLY", monthDay: "10", description: "Outra descrição" }, prisma);
    await changeScheduleState(id, "pause", prisma);

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "RECURRING_REQUEST", entityId: id }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action, actorId }) => [action, actorId])).toEqual([
      ["CREATED", gabi.id],
      ["UPDATED", gabi.id],
      ["UPDATED", gabi.id],
    ]);
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "frequency", before: "WEEKLY", after: "MONTHLY" },
        { field: "recurrenceWeekdays", before: ["1", "4"], after: [] },
        { field: "monthDay", before: null, after: 10 },
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain("Outra descrição");
    expect(JSON.stringify(entries)).not.toContain("Sala 12");
    expect(entries[2].changes).toEqual([{ field: "pausedAt", before: null, after: expect.any(String) }]);
  });
});

describe("the schedule's rules (5.3 item 2; CA-REC-02)", () => {
  it("refuses an unavailable service, an inactive or non-requester person and dates out of the rules", async () => {
    const { admin, ana, air, maintenance, input, today } = await scenario();
    actAs(admin);
    const inactive = await createDomainUser({ role: "REQUESTER", isActive: false });

    for (const requesterId of [inactive.id, ana.id]) {
      await expect(createSchedule({ ...input, requesterId }, prisma)).rejects.toMatchObject({ issues: [{ path: ["requesterId"] }] });
    }
    await expect(createSchedule({ ...input, startsOn: addDays(today, -1) }, prisma)).rejects.toMatchObject({ issues: [{ path: ["startsOn"] }] });
    await expect(createSchedule({ ...input, endsOn: addDays(today, 732) }, prisma)).rejects.toMatchObject({ issues: [{ path: ["endsOn"] }] });
    await expect(createSchedule({ ...input, weekdays: [] }, prisma)).rejects.toBeInstanceOf(ValidationError);

    await prisma.serviceDocumentRequirement.create({ data: { serviceId: air.id, name: "Laudo", isRequired: false, acceptedFormats: ["PDF"], position: 1 } });
    await expect(createSchedule(input, prisma)).rejects.toMatchObject({ issues: [{ path: ["serviceId"] }] });
    await expect(listScheduleServiceFields(air.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listScheduleOverview(prisma)).services.map(({ id }) => id)).not.toContain(air.id);
    await prisma.serviceDocumentRequirement.deleteMany({ where: { serviceId: air.id } });

    await prisma.sector.update({ where: { id: maintenance.id }, data: { isActive: false } });
    await expect(createSchedule(input, prisma)).rejects.toMatchObject({ issues: [{ path: ["serviceId"] }] });
    expect(await prisma.recurringRequest.count()).toBe(0);
  });

  it("checks the answers exactly as the opening does", async () => {
    const { admin, room, input } = await scenario();
    actAs(admin);
    await expect(createSchedule({ ...input, answers: {} }, prisma)).rejects.toMatchObject({ reason: "invalid", fieldErrors: [{ fieldId: room.id, code: "required" }] });
    await expect(createSchedule({ ...input, answers: { [crypto.randomUUID()]: "x" } }, prisma)).rejects.toMatchObject({ reason: "stale_form" });
    await expect(createSchedule({ ...input, answers: { [room.id]: "linha\noutra" } }, prisma)).rejects.toBeInstanceOf(FieldAnswersError);

    const { id } = await createSchedule(input, prisma);
    expect(await prisma.recurringRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({
      answers: { [room.id]: "Sala 12" },
      weekdays: [1, 4],
      monthDay: null,
      createdById: admin.id,
      consecutiveFailures: 0,
    });
  });

  it(`allows at most ${MAX_ACTIVE_SCHEDULES} schedules in force; ended or finished ones do not count`, async () => {
    const { admin, rita, air, input, today } = await scenario();
    actAs(admin);
    const base = { name: "Agenda", serviceId: air.id, requesterId: rita.id, createdById: admin.id, description: "x", frequency: "MONTHLY" as const, monthDay: 5, startsOn: day(today) };
    await prisma.recurringRequest.createMany({ data: Array.from({ length: MAX_ACTIVE_SCHEDULES - 1 }, () => base) });
    // Ended or past its end: not in force.
    await prisma.recurringRequest.create({ data: { ...base, endedAt: new Date() } });

    const { id } = await createSchedule(input, prisma);
    await expect(createSchedule(input, prisma)).rejects.toMatchObject({ issues: [{ path: [], code: "too_big" }] });
    await changeScheduleState(id, "end", prisma);
    await expect(createSchedule(input, prisma)).resolves.toMatchObject({ id: expect.any(String) });
  });
});

describe("changing, pausing, resuming and ending (5.3 items 2 and 4; CA-REC-05)", () => {
  it("follows the state of the schedule; an ended schedule is history", async () => {
    const { gabi, input } = await scenario();
    actAs(gabi);
    const { id } = await createSchedule(input, prisma);
    await prisma.recurringRequest.update({ where: { id }, data: { consecutiveFailures: 2 } });

    await expect(changeScheduleState(id, "resume", prisma)).rejects.toBeInstanceOf(ConflictError);
    await changeScheduleState(id, "pause", prisma);
    await expect(changeScheduleState(id, "pause", prisma)).rejects.toBeInstanceOf(ConflictError);
    let [view] = (await listScheduleOverview(prisma)).schedules;
    expect(view).toMatchObject({ status: "paused", nextOn: null, actions: ["edit", "resume", "end"] });

    // Resuming clears the failures in a row.
    await changeScheduleState(id, "resume", prisma);
    expect(await prisma.recurringRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ pausedAt: null, consecutiveFailures: 0 });
    [view] = (await listScheduleOverview(prisma)).schedules;
    expect(view).toMatchObject({ status: "active", actions: ["edit", "pause", "end"] });
    expect(view.nextOn).not.toBeNull();

    await changeScheduleState(id, "end", prisma);
    [view] = (await listScheduleOverview(prisma)).schedules;
    expect(view).toMatchObject({ status: "ended", nextOn: null, actions: [] });
    for (const change of ["pause", "resume", "end"] as const) {
      await expect(changeScheduleState(id, change, prisma)).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(updateSchedule(id, input, prisma)).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps a start already past when it does not change; a new start must be today or later", async () => {
    const { admin, input, today } = await scenario();
    actAs(admin);
    const { id } = await createSchedule(input, prisma);
    const past = addDays(today, -10);
    await prisma.recurringRequest.update({ where: { id }, data: { startsOn: day(past) } });

    await expect(updateSchedule(id, { ...input, startsOn: past, name: "Limpeza mensal" }, prisma)).resolves.toMatchObject({ id });
    await expect(updateSchedule(id, { ...input, startsOn: addDays(today, -1) }, prisma)).rejects.toMatchObject({ issues: [{ path: ["startsOn"] }] });
    expect(await prisma.recurringRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Limpeza mensal", startsOn: day(past) });
  });

  it("a manager cannot reach a schedule of another sector, nor move one there", async () => {
    const { admin, gabi, laptop, input } = await scenario();
    actAs(admin);
    const other = await createSchedule({ ...input, serviceId: laptop.id, answers: {} }, prisma);
    const own = await createSchedule(input, prisma);

    actAs(gabi);
    await expect(changeScheduleState(other.id, "pause", prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateSchedule(other.id, input, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateSchedule(own.id, { ...input, serviceId: laptop.id, answers: {} }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeScheduleState(crypto.randomUUID(), "end", prisma)).rejects.toBeInstanceOf(NotFoundError);
  });
});
