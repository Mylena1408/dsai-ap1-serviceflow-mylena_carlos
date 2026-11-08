import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { NotFoundError } from "@/server/errors";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { addDays } from "@/shared/time";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 5.3 items 3 and 4 (SF-186; CA-REC-01, 03, 04 and 05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getRequestScheduleName, runRecurringSchedules } from "@/modules/requests";
import { runDailyJob } from "@/server/jobs";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

async function scenario(overrides: { startsOn?: string; endsOn?: string | null; weekdays?: number[] } = {}) {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const room = await prisma.serviceField.create({
    data: { serviceId: service.id, label: "Sala", type: "SHORT_TEXT", isRequired: true, options: [], position: 1 },
  });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const today = await organizationToday(prisma);
  const schedule = await prisma.recurringRequest.create({
    data: {
      name: "Limpeza do ar",
      serviceId: service.id,
      requesterId: rita.id,
      createdById: gabi.id,
      description: "Limpeza preventiva dos filtros",
      answers: { [room.id]: "Sala 12" },
      frequency: "WEEKLY",
      weekdays: overrides.weekdays ?? EVERY_DAY,
      startsOn: day(overrides.startsOn ?? today),
      endsOn: overrides.endsOn ? day(overrides.endsOn) : null,
    },
  });
  return { sector, service, room, gabi, rita, today, schedule };
}

const runsOf = (scheduleId: string) => prisma.recurringRequestRun.findMany({ where: { recurringRequestId: scheduleId }, orderBy: { scheduledOn: "asc" } });

describe("without schedules (CA-REC-01)", () => {
  it("the job's step does nothing", async () => {
    const summary = await runDailyJob();
    expect(summary.recurringRequests).toEqual({ status: "ok", result: { opened: 0, skipped: 0, paused: 0, failed: 0 } });
    expect(await prisma.request.count()).toBe(0);
  });
});

describe("opening on the day (5.3 item 3; CA-REC-03)", () => {
  it("opens the request as the normal opening does, once per schedule and day", async () => {
    const { schedule, service, room, rita, sector, today } = await scenario();

    expect((await runDailyJob()).recurringRequests).toEqual({ status: "ok", result: { opened: 1, skipped: 0, paused: 0, failed: 0 } });
    const request = await prisma.request.findFirstOrThrow({ where: { recurringRequestId: schedule.id } });
    expect(request).toMatchObject({
      requesterId: rita.id,
      serviceId: service.id,
      sectorId: sector.id,
      description: "Limpeza preventiva dos filtros",
      status: "OPEN",
      groupId: null,
    });
    expect(await prisma.requestFieldValue.findMany({ where: { requestId: request.id }, select: { fieldId: true, value: true } })).toEqual([
      { fieldId: room.id, value: "Sala 12" },
    ]);
    expect(await prisma.requestStatusEvent.findFirst({ where: { requestId: request.id } })).toMatchObject({ actorId: rita.id, toStatus: "OPEN" });
    expect(await prisma.outboxEvent.count({ where: { type: "request.opened", requestId: request.id } })).toBe(1);
    expect(await runsOf(schedule.id)).toEqual([expect.objectContaining({ scheduledOn: day(today), outcome: "OPENED", requestId: request.id, reason: null })]);

    // A second run on the same day finds nothing to do.
    await expect(runRecurringSchedules(prisma)).resolves.toEqual({ opened: 0, skipped: 0, paused: 0, failed: 0 });
    expect(await prisma.request.count({ where: { recurringRequestId: schedule.id } })).toBe(1);
  });

  it("two jobs at once still open one request", async () => {
    const { schedule } = await scenario();
    const results = await Promise.all([runRecurringSchedules(prisma), runRecurringSchedules(prisma), runRecurringSchedules(prisma)]);
    expect(results.reduce((total, result) => total + result.opened, 0)).toBe(1);
    expect(results.every((result) => result.failed === 0)).toBe(true);
    expect(await prisma.request.count({ where: { recurringRequestId: schedule.id } })).toBe(1);
    expect(await runsOf(schedule.id)).toHaveLength(1);
  });

  it("does not recover the days the job missed (decision H10)", async () => {
    const { schedule, today } = await scenario({ startsOn: undefined });
    await prisma.recurringRequest.update({ where: { id: schedule.id }, data: { startsOn: day(addDays(today, -6)) } });
    await prisma.recurringRequestRun.create({
      data: { recurringRequestId: schedule.id, scheduledOn: day(addDays(today, -6)), outcome: "SKIPPED", reason: "FORM_CHANGED", occurredAt: new Date() },
    });

    await expect(runRecurringSchedules(prisma)).resolves.toMatchObject({ opened: 1 });
    expect((await runsOf(schedule.id)).map(({ scheduledOn }) => scheduledOn)).toEqual([day(addDays(today, -6)), day(today)]);
  });

  it("only on the schedule's days, within its period, and never while paused or ended (CA-REC-05)", async () => {
    const { today } = await scenario();
    const other = await scenario({ startsOn: addDays(today, 1) });
    const tomorrowOnly = await scenario({ weekdays: [((new Date(`${today}T12:00:00Z`).getUTCDay() + 1) % 7) || 7] });
    const paused = await scenario();
    await prisma.recurringRequest.update({ where: { id: paused.schedule.id }, data: { pausedAt: new Date() } });
    const ended = await scenario();
    await prisma.recurringRequest.update({ where: { id: ended.schedule.id }, data: { endedAt: new Date() } });
    const finished = await scenario({ startsOn: addDays(today, -3), endsOn: addDays(today, -1) });
    await prisma.recurringRequest.update({ where: { id: finished.schedule.id }, data: { startsOn: day(addDays(today, -3)) } });

    await expect(runRecurringSchedules(prisma)).resolves.toMatchObject({ opened: 1 });
    for (const schedule of [other.schedule, tomorrowOnly.schedule, paused.schedule, ended.schedule, finished.schedule]) {
      expect(await runsOf(schedule.id)).toEqual([]);
    }
  });
});

describe("runs that do not open (5.3 item 3; CA-REC-04)", () => {
  it("records the reason, counts the failures in a row and pauses on the third", async () => {
    const cases = [
      async ({ service }: Awaited<ReturnType<typeof scenario>>) => prisma.service.update({ where: { id: service.id }, data: { isActive: false } }),
      async ({ rita }: Awaited<ReturnType<typeof scenario>>) => prisma.user.update({ where: { id: rita.id }, data: { isActive: false } }),
      async ({ service }: Awaited<ReturnType<typeof scenario>>) =>
        prisma.serviceDocumentRequirement.create({ data: { serviceId: service.id, name: "Laudo", isRequired: false, acceptedFormats: ["PDF"], position: 1 } }),
      async ({ service }: Awaited<ReturnType<typeof scenario>>) =>
        prisma.serviceField.create({ data: { serviceId: service.id, label: "Andar", type: "INTEGER", isRequired: true, options: [], position: 2 } }),
    ];
    const reasons = ["SERVICE_UNAVAILABLE", "REQUESTER_INACTIVE", "DOCUMENT_REQUIRED", "FORM_CHANGED"];
    const schedules = [];
    for (const change of cases) {
      const built = await scenario();
      await change(built);
      schedules.push(built.schedule);
    }
    // The last one already had two failures in a row: this one pauses it.
    await prisma.recurringRequest.update({ where: { id: schedules[3].id }, data: { consecutiveFailures: 2 } });

    await expect(runRecurringSchedules(prisma)).resolves.toEqual({ opened: 0, skipped: 4, paused: 1, failed: 0 });
    for (const [index, schedule] of schedules.entries()) {
      expect(await runsOf(schedule.id)).toEqual([expect.objectContaining({ outcome: "SKIPPED", reason: reasons[index], requestId: null })]);
    }
    const states = await prisma.recurringRequest.findMany({ where: { id: { in: schedules.map(({ id }) => id) } }, select: { id: true, consecutiveFailures: true, pausedAt: true } });
    const byId = new Map(states.map((state) => [state.id, state]));
    expect(schedules.slice(0, 3).map(({ id }) => byId.get(id))).toEqual(schedules.slice(0, 3).map(({ id }) => ({ id, consecutiveFailures: 1, pausedAt: null })));
    expect(byId.get(schedules[3].id)).toMatchObject({ consecutiveFailures: 3, pausedAt: expect.any(Date) });
    expect(await prisma.request.count()).toBe(0);
  });

  it("an opened run clears the failures in a row", async () => {
    const { schedule } = await scenario();
    await prisma.recurringRequest.update({ where: { id: schedule.id }, data: { consecutiveFailures: 2 } });
    await runRecurringSchedules(prisma);
    expect(await prisma.recurringRequest.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({ consecutiveFailures: 0, pausedAt: null });
  });
});

describe("the request shows its schedule (5.3 item 4)", () => {
  it("to whoever reads the request", async () => {
    const { rita } = await scenario();
    await runRecurringSchedules(prisma);
    const request = await prisma.request.findFirstOrThrow({ where: { requesterId: rita.id } });

    actAs(rita);
    await expect(getRequestScheduleName(request.id, prisma)).resolves.toBe("Limpeza do ar");

    const stranger = await createDomainUser({ role: "REQUESTER" });
    actAs(stranger);
    await expect(getRequestScheduleName(request.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });
});
