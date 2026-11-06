import { describe, expect, it, vi } from "vitest";
import type { Prisma, RequestStatus } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { createPrismaAnalyticsReader } from "@/modules/reports/infrastructure/prisma-analytics-reader";

// SPEC 2026-11-06-analises-operacionais, 5.3 to 5.6 and 5.8 over the database (SF-145;
// CA-ANL-03 to 08). Every expected number below is derived in the comments of the scenario.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnalytics, getAttendantDashboard } from "@/modules/reports";

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;
const now = at("2026-11-06T15:00:00.000Z");
// October in São Paulo (UTC-3): 2026-10-01 00:00 to 2026-11-01 00:00.
const october = { from: at("2026-10-01T03:00:00.000Z"), before: at("2026-11-01T03:00:00.000Z") };

/**
 * Sector A (attendants Ana and Bruno, inactive) and sector B (Caio). Requests of sector A:
 * - r1: opened 05/10 12:00Z; Ana commented internally at 12:10 and publicly at 12:20 (first
 *   response, 20 min), started 12:30; stages Triagem 12:30 and Execução 13:30; paused 13:40 to
 *   14:00; completed 15:00 on time (3 h), HIGH, Ana.
 * - r2: opened 06/10 10:00Z; the requester commented at 10:30 (not a response); started 11:00
 *   (1 h); a pause from 07/10 09:00 never resumed; completed 07/10 10:00 late (24 h), URGENT, Bruno.
 * - r3: opened 31/10 23:59 in São Paulo (a Saturday, 23 h), open, without assignee.
 * - r4: opened 02/10 12:00Z, cancelled 03/10 12:00Z.
 * - r5: opened 01/10 12:00Z (a Thursday, 9 h in São Paulo), started 13:00 (1 h), completed
 *   02/10 12:00Z, reopened 04/10 12:00Z, open with Ana.
 * - r7: opened 08/10, waiting for approval, without assignee (not "sem responsável").
 * - r8: opened 09/10 12:00Z, started 14:00 (2 h), in progress at Triagem with Ana, overdue.
 * Sector B: r6 opened 05/10, open with Caio, with a public comment of Caio.
 */
async function scenario() {
  const sectorA = await createDomainSector();
  const sectorB = await createDomainSector();
  const category = await createDomainCategory();
  const serviceA = await createDomainService({ categoryId: category.id, sectorId: sectorA.id });
  const serviceB = await createDomainService({ categoryId: category.id, sectorId: sectorB.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const person = (name: string, sectorId: string, isActive = true) =>
    prisma.user.create({
      data: { name, email: `${name.toLowerCase()}-${crypto.randomUUID()}@example.test`, role: "ATTENDANT", sectorId, isActive, passwordHash: "$argon2id$integration-placeholder" },
    });
  const ana = await person("Ana", sectorA.id);
  const bruno = await person("Bruno", sectorA.id, false);
  const caio = await person("Caio", sectorB.id);

  async function request(sector: "A" | "B", data: Partial<Prisma.RequestUncheckedCreateInput> & { createdAt: Date }, events: Array<[RequestStatus, string]>) {
    const created = await prisma.request.create({
      data: {
        requesterId: rita.id,
        serviceId: sector === "A" ? serviceA.id : serviceB.id,
        sectorId: sector === "A" ? sectorA.id : sectorB.id,
        serviceNameSnapshot: "Reparo",
        serviceDescriptionSnapshot: "Serviço",
        categoryIdSnapshot: category.id,
        categoryNameSnapshot: "Manutenção",
        sectorNameSnapshot: sector,
        description: "Texto confidencial",
        ...data,
      },
    });
    let previous: RequestStatus | null = null;
    for (const [toStatus, iso] of events) {
      await prisma.requestStatusEvent.create({ data: { requestId: created.id, actorId: rita.id, fromStatus: previous, toStatus, occurredAt: at(iso) } });
      previous = toStatus;
    }
    return created;
  }

  const r1 = await request(
    "A",
    {
      createdAt: at("2026-10-05T12:00:00Z"),
      status: "COMPLETED",
      completedAt: at("2026-10-05T15:00:00Z"),
      slaHoursSnapshot: 8,
      dueAt: at("2026-10-05T20:00:00Z"),
      completedLate: false,
      priority: "HIGH",
      assigneeId: ana.id,
      stageNamesSnapshot: ["Triagem", "Execução"],
      stageIndex: 1,
    },
    [["OPEN", "2026-10-05T12:00:00Z"], ["IN_PROGRESS", "2026-10-05T12:30:00Z"], ["COMPLETED", "2026-10-05T15:00:00Z"]],
  );
  await prisma.requestComment.create({ data: { requestId: r1.id, authorId: ana.id, body: "nota", isInternal: true, createdAt: at("2026-10-05T12:10:00Z") } });
  await prisma.requestComment.create({ data: { requestId: r1.id, authorId: ana.id, body: "resposta", createdAt: at("2026-10-05T12:20:00Z") } });
  await prisma.requestStageEvent.create({ data: { requestId: r1.id, actorId: ana.id, toStage: "Triagem", occurredAt: at("2026-10-05T12:30:00Z") } });
  await prisma.requestStageEvent.create({ data: { requestId: r1.id, actorId: ana.id, fromStage: "Triagem", toStage: "Execução", occurredAt: at("2026-10-05T13:30:00Z") } });
  await prisma.requestSlaPause.create({
    data: { requestId: r1.id, pausedById: ana.id, reason: "Aguardando peça", pausedAt: at("2026-10-05T13:40:00Z"), resumedAt: at("2026-10-05T14:00:00Z"), resumedById: ana.id, resumeCause: "MANUAL" },
  });

  const r2 = await request(
    "A",
    {
      createdAt: at("2026-10-06T10:00:00Z"),
      status: "COMPLETED",
      completedAt: at("2026-10-07T10:00:00Z"),
      slaHoursSnapshot: 4,
      dueAt: at("2026-10-06T14:00:00Z"),
      completedLate: true,
      priority: "URGENT",
      assigneeId: bruno.id,
    },
    [["OPEN", "2026-10-06T10:00:00Z"], ["IN_PROGRESS", "2026-10-06T11:00:00Z"], ["COMPLETED", "2026-10-07T10:00:00Z"]],
  );
  await prisma.requestComment.create({ data: { requestId: r2.id, authorId: rita.id, body: "alguma novidade?", createdAt: at("2026-10-06T10:30:00Z") } });
  await prisma.requestSlaPause.create({ data: { requestId: r2.id, pausedById: bruno.id, reason: "Aguardando", pausedAt: at("2026-10-07T09:00:00Z") } });

  await request("A", { createdAt: at("2026-11-01T02:59:00Z") }, [["OPEN", "2026-11-01T02:59:00Z"]]);
  await request(
    "A",
    { createdAt: at("2026-10-02T12:00:00Z"), status: "CANCELLED", cancelledAt: at("2026-10-03T12:00:00Z") },
    [["OPEN", "2026-10-02T12:00:00Z"], ["CANCELLED", "2026-10-03T12:00:00Z"]],
  );
  await request(
    "A",
    { createdAt: at("2026-10-01T12:00:00Z"), assigneeId: ana.id },
    [["OPEN", "2026-10-01T12:00:00Z"], ["IN_PROGRESS", "2026-10-01T13:00:00Z"], ["COMPLETED", "2026-10-02T12:00:00Z"], ["OPEN", "2026-10-04T12:00:00Z"]],
  );
  await request("A", { createdAt: at("2026-10-08T12:00:00Z"), approvalState: "PENDING" }, [["OPEN", "2026-10-08T12:00:00Z"]]);
  await request(
    "A",
    {
      createdAt: at("2026-10-09T12:00:00Z"),
      status: "IN_PROGRESS",
      assigneeId: ana.id,
      stageNamesSnapshot: ["Triagem", "Execução"],
      stageIndex: 0,
      slaHoursSnapshot: 4,
      dueAt: at("2026-10-09T16:00:00Z"),
    },
    [["OPEN", "2026-10-09T12:00:00Z"], ["IN_PROGRESS", "2026-10-09T14:00:00Z"]],
  );
  const r6 = await request("B", { createdAt: at("2026-10-05T12:00:00Z"), assigneeId: caio.id }, [["OPEN", "2026-10-05T12:00:00Z"]]);
  await prisma.requestComment.create({ data: { requestId: r6.id, authorId: caio.id, body: "olá", createdAt: at("2026-10-05T13:00:00Z") } });

  return { sectorA, sectorB, ana, bruno, caio };
}

const reader = createPrismaAnalyticsReader(prisma);

describe("analytics reader over the database (SF-145)", () => {
  it("counts the attendant's queue and work (CA-ANL-03)", async () => {
    const { sectorA, ana } = await scenario();
    const scope = { sectorId: sectorA.id, attendantId: ana.id };

    const queue = await reader.attendantQueue(scope, now);
    // r3 without assignee; r7 waits for approval and does not count; r5 and r8 are Ana's.
    expect(queue).toMatchObject({ unassigned: 1, mine: 2, dueSoon: 0, overdue: 1, paused: 0 });
    expect(queue.byPriority).toEqual([{ priority: "NORMAL", count: 4 }]);
    expect(queue.byStage).toEqual([{ label: "Triagem", count: 1 }]);

    const work = await reader.attendantWork(scope, october);
    expect(work.mine).toEqual({ completed: 1, completion: { count: 1, averageMs: 3 * HOUR, medianMs: 3 * HOUR }, withDueDate: 1, onTime: 1, replies: 1 });
    expect(work.sector).toEqual({
      completed: 2,
      completion: { count: 2, averageMs: 13.5 * HOUR, medianMs: 13.5 * HOUR },
      withDueDate: 2,
      onTime: 1,
      // Ana's public reply only: the internal note, the requester's comment and Caio (sector B) do not count.
      replies: 1,
    });
  });

  it("counts opened and completed per São Paulo day (CA-ANL-04 and 07)", async () => {
    const { sectorA } = await scenario();
    const daily = await reader.dailyCounts({ sectorId: sectorA.id }, october);
    expect(daily).toEqual([
      { day: "2026-10-01", opened: 1, completed: 0, withDueDate: 0, onTime: 0 },
      { day: "2026-10-02", opened: 1, completed: 0, withDueDate: 0, onTime: 0 },
      { day: "2026-10-05", opened: 1, completed: 1, withDueDate: 1, onTime: 1 },
      { day: "2026-10-06", opened: 1, completed: 0, withDueDate: 0, onTime: 0 },
      { day: "2026-10-07", opened: 0, completed: 1, withDueDate: 1, onTime: 0 },
      { day: "2026-10-08", opened: 1, completed: 0, withDueDate: 0, onTime: 0 },
      { day: "2026-10-09", opened: 1, completed: 0, withDueDate: 0, onTime: 0 },
      // r3, opened at 23:59 of October 31 in São Paulo (02:59 UTC of November 1).
      { day: "2026-10-31", opened: 1, completed: 0, withDueDate: 0, onTime: 0 },
    ]);
  });

  it("follows the last status event for the pending count, with cancellation and reopening (CA-ANL-04)", async () => {
    const { sectorA, sectorB } = await scenario();
    const ends = ["2026-10-02T03:00:00Z", "2026-10-03T03:00:00Z", "2026-10-04T03:00:00Z", "2026-10-05T03:00:00Z"].map(at);
    // End of 01/10: r5 in progress. 02/10: r5 completed, r4 open. 03/10: r4 cancelled. 04/10: r5 reopened.
    expect(await reader.pendingAt({ sectorId: sectorA.id }, ends)).toEqual([1, 1, 0, 1]);
    expect(await reader.pendingAt({ sectorId: sectorB.id }, ends)).toEqual([0, 0, 0, 0]);
    expect(await reader.pendingAt({ sectorId: null }, [now])).toEqual([5]);
  });

  it("measures the first response from public replies of attendants or the start (CA-ANL-05)", async () => {
    const { sectorA } = await scenario();
    const result = await reader.firstResponse({ sectorId: sectorA.id }, october);
    // r1 20 min (the public reply came before the start), r2 1 h, r5 1 h, r8 2 h; r3, r4, r7 without one.
    expect(result.unanswered).toBe(3);
    expect(result.answered.count).toBe(4);
    expect(result.answered.averageMs).toBeCloseTo(((1 / 3 + 1 + 1 + 2) / 4) * HOUR, 0);
    expect(result.answered.medianMs).toBeCloseTo(HOUR, 0);
  });

  it("measures stages, pauses and on-time shares of the completed requests (CA-ANL-06)", async () => {
    const { sectorA } = await scenario();
    const scope = { sectorId: sectorA.id };

    expect(await reader.stageTimes(scope, october)).toEqual([
      { serviceName: "Reparo", stageName: "Execução", stageOrder: 2, duration: { count: 1, averageMs: 1.5 * HOUR, medianMs: 1.5 * HOUR } },
      { serviceName: "Reparo", stageName: "Triagem", stageOrder: 1, duration: { count: 1, averageMs: HOUR, medianMs: HOUR } },
    ].sort((left, right) => left.stageName.localeCompare(right.stageName)));

    const pauses = await reader.pauses(scope, october);
    // r1 20 min; r2 never resumed, counted until the completion: 1 h.
    expect(pauses.completed).toBe(2);
    expect(pauses.paused.count).toBe(2);
    expect(pauses.paused.averageMs).toBeCloseTo((2 / 3) * HOUR, 0);

    expect(await reader.onTimeByService(scope, october)).toEqual([{ label: "Reparo", withDueDate: 2, onTime: 1 }]);
    const byPriority = await reader.onTimeByPriority(scope, october);
    expect(byPriority.sort((left, right) => left.priority.localeCompare(right.priority))).toEqual([
      { priority: "HIGH", withDueDate: 1, onTime: 1 },
      { priority: "URGENT", withDueDate: 1, onTime: 0 },
    ]);
  });

  it("places arrivals by São Paulo weekday and hour (CA-ANL-07)", async () => {
    const { sectorA } = await scenario();
    const arrivals = await reader.arrivals({ sectorId: sectorA.id }, october);
    expect(arrivals.reduce((sum, row) => sum + row.count, 0)).toBe(7);
    // r3: Saturday (ISO 6) at 23 h. r5 (01/10) and r7 (08/10): Thursdays (ISO 4) at 9 h.
    // r4 (02/10) and r8 (09/10): Fridays at 9 h. r1: Monday at 9 h. r2: Tuesday at 7 h.
    expect(arrivals.sort((left, right) => left.isoWeekday - right.isoWeekday || left.hour - right.hour)).toEqual([
      { isoWeekday: 1, hour: 9, count: 1 },
      { isoWeekday: 2, hour: 7, count: 1 },
      { isoWeekday: 4, hour: 9, count: 2 },
      { isoWeekday: 5, hour: 9, count: 2 },
      { isoWeekday: 6, hour: 23, count: 1 },
    ]);
  });

  it("lists the attendants of the scope with completed and pending work (CA-ANL-08)", async () => {
    const { sectorA, ana, bruno, caio } = await scenario();
    const team = await reader.team({ sectorId: sectorA.id }, october);
    const byName = new Map(team.map((row) => [row.name, row]));
    expect([...byName.keys()].sort()).toEqual(["Ana", "Bruno"]);
    expect(byName.get("Ana")).toMatchObject({ userId: ana.id, isActive: true, completed: 1, withDueDate: 1, onTime: 1, pendingNow: 2 });
    expect(byName.get("Ana")!.completion).toEqual({ count: 1, averageMs: 3 * HOUR, medianMs: 3 * HOUR });
    expect(byName.get("Bruno")).toMatchObject({ userId: bruno.id, isActive: false, completed: 1, onTime: 0, pendingNow: 0 });

    const organization = await reader.team({ sectorId: null }, october);
    expect(organization.find((row) => row.userId === caio.id)).toMatchObject({ completed: 0, pendingNow: 1 });
  });
});

describe("analytics use cases over the database (SF-145)", () => {
  const actAs = (user: { id: string; name: string; email: string; role: string; sectorId: string | null }) =>
    session.getCurrentUser.mockResolvedValue({ ...user, isActive: true });

  it("gives the attendant only the own sector and own numbers", async () => {
    const { ana } = await scenario();
    actAs(ana);
    const result = await getAttendantDashboard({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, prisma, now);
    expect(result).toMatchObject({ withoutSector: false, queue: { unassigned: 1, mine: 2 } });
    expect(result.mine).toMatchObject({ completed: 1, onTimePercentage: 100, replies: 1 });
    expect(result.sector).toMatchObject({ completed: 2, onTimePercentage: 50, completion: { averageHours: 13.5 } });
  });

  it("gives the administrator a sector's analytics in alphabetical team order", async () => {
    const { sectorA } = await scenario();
    const admin = await createDomainUser({ role: "ADMIN" });
    actAs({ ...admin, sectorId: null });
    const result = await getAnalytics({ period: "custom", from: "2026-10-01", to: "2026-10-31", sector: sectorA.id }, prisma, now);
    expect(result.granularity).toBe("day");
    expect(result.trend).toHaveLength(31);
    expect(result.trend.find((point) => point.label === "05/10")).toMatchObject({ opened: 1, completed: 1, onTimePercentage: 100 });
    expect(result.team.map(({ name }) => name)).toEqual(["Ana", "Bruno"]);
    expect(result.sla.firstResponse).toMatchObject({ answered: 4, unanswered: 3 });
    expect(result.sla.stages.map(({ stageName }) => stageName)).toEqual(["Triagem", "Execução"]);
  });
});
