import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/errors";
import type { AnalyticsReader, AttendantQueueCounts, WorkTotals } from "@/modules/reports/application/analytics-ports";
import type { ReportSector } from "@/modules/reports/application/ports";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getAnalytics, getAttendantDashboard } from "@/modules/reports/application/analytics";

// SPEC 2026-11-06-analises-operacionais, 5.1 and 5.3 to 5.6 (SF-145; CA-ANL-02, 03, 08).

const now = new Date("2026-11-06T15:00:00.000Z");
const HOUR = 3_600_000;
const central: ReportSector = { id: "11111111-1111-4111-8111-111111111111", name: "Central", isActive: true };
const archive: ReportSector = { id: "22222222-2222-4222-8222-222222222222", name: "Arquivo", isActive: false };

const work = (overrides: Partial<WorkTotals> = {}): WorkTotals => ({
  completed: 4,
  completion: { count: 4, averageMs: 10 * HOUR, medianMs: 6 * HOUR },
  withDueDate: 4,
  onTime: 3,
  replies: 7,
  ...overrides,
});

const queue: AttendantQueueCounts = {
  unassigned: 3,
  mine: 2,
  dueSoon: 1,
  overdue: 1,
  paused: 0,
  byPriority: [
    { priority: "NORMAL", count: 4 },
    { priority: "URGENT", count: 1 },
  ],
  byStage: [
    { label: null, count: 1 },
    { label: "Execução", count: 3 },
    { label: "Análise", count: 3 },
  ],
};

function reader(overrides: Partial<AnalyticsReader> = {}): AnalyticsReader {
  return {
    findSector: vi.fn(async (id: string) => [central, archive].find((sector) => sector.id === id) ?? null),
    listSectors: vi.fn(async () => [archive, central]),
    attendantQueue: vi.fn(async () => queue),
    attendantWork: vi.fn(async () => ({ mine: work(), sector: work({ completed: 10, replies: 20 }) })),
    dailyCounts: vi.fn(async () => [{ day: "2026-11-05", opened: 3, completed: 2, withDueDate: 2, onTime: 1 }]),
    pendingAt: vi.fn(async (_scope, instants: readonly Date[]) => instants.map((_, index) => index)),
    firstResponse: vi.fn(async () => ({ answered: { count: 5, averageMs: 2 * HOUR, medianMs: HOUR }, unanswered: 2 })),
    stageTimes: vi.fn(async () => [{ serviceName: "Reparo", stageName: "Triagem", stageOrder: 1, duration: { count: 2, averageMs: HOUR, medianMs: HOUR } }]),
    pauses: vi.fn(async () => ({ completed: 6, paused: { count: 2, averageMs: 3 * HOUR, medianMs: 3 * HOUR } })),
    onTimeByService: vi.fn(async () => [{ label: "Reparo", withDueDate: 5, onTime: 4 }]),
    onTimeByPriority: vi.fn(async () => [
      { priority: "LOW" as const, withDueDate: 1, onTime: 1 },
      { priority: "URGENT" as const, withDueDate: 4, onTime: 2 },
    ]),
    arrivals: vi.fn(async () => [{ isoWeekday: 3, hour: 10, count: 4 }]),
    team: vi.fn(async () => [
      {
        userId: "b",
        name: "Bruno",
        isActive: false,
        sectorName: "Central",
        completed: 2,
        completion: { count: 2, averageMs: HOUR, medianMs: HOUR },
        withDueDate: 2,
        onTime: 1,
        pendingNow: 1,
      },
      {
        userId: "a",
        name: "Ana",
        isActive: true,
        sectorName: "Central",
        completed: 0,
        completion: { count: 0, averageMs: null, medianMs: null },
        withDueDate: 0,
        onTime: 0,
        pendingNow: 2,
      },
    ]),
    escalations: vi.fn(async () => 2),
    // SPEC 2026-11-06-pesquisa-satisfacao, 4.7.
    satisfaction: vi.fn(async () => ({
      distribution: [
        { rating: 5, count: 3 },
        { rating: 2, count: 1 },
      ],
      completed: 8,
      ratedCompletions: 4,
      byService: [{ label: "Reparo", count: 4, sum: 17 }],
    })),
    ...overrides,
  };
}

const actor =(role: string, sectorId: string | null = central.id) => ({ id: `${role.toLowerCase()}-1`, role, sectorId, isActive: true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAttendantDashboard (5.3)", () => {
  it("reads the attendant's current sector and own numbers", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ATTENDANT"));
    const source = reader();

    const result = await getAttendantDashboard({ period: "7" }, source, now);

    expect(source.attendantQueue).toHaveBeenCalledWith({ sectorId: central.id, attendantId: "attendant-1" }, now);
    expect(source.attendantWork).toHaveBeenCalledWith(
      { sectorId: central.id, attendantId: "attendant-1" },
      { from: result.period.from, before: result.period.before },
    );
    expect(result).toMatchObject({ withoutSector: false, sectorName: "Central", periodError: null });
    expect(result.queue).toMatchObject({ unassigned: 3, mine: 2, dueSoon: 1, overdue: 1, paused: 0 });
    expect(result.mine).toEqual({ completed: 4, completion: { averageHours: 10, medianHours: 6 }, onTimePercentage: 75, replies: 7 });
    expect(result.sector).toMatchObject({ completed: 10, replies: 20 });
  });

  it("lists every priority from the most urgent and stages by count, then name", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ATTENDANT"));
    const result = await getAttendantDashboard({}, reader(), now);
    expect(result.queue.byPriority).toEqual([
      { label: "Urgente", count: 1 },
      { label: "Alta", count: 0 },
      { label: "Normal", count: 4 },
      { label: "Baixa", count: 0 },
    ]);
    expect(result.queue.byStage).toEqual([
      { label: "Análise", count: 3 },
      { label: "Execução", count: 3 },
      { label: "Sem etapa", count: 1 },
    ]);
  });

  it.each([
    ["no sector", null],
    ["an inactive sector", archive.id],
  ])("shows the notice and reads nothing for an attendant with %s", async (_case, sectorId) => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ATTENDANT", sectorId));
    const source = reader();
    const result = await getAttendantDashboard({}, source, now);
    expect(result.withoutSector).toBe(true);
    expect(result.mine.completed).toBe(0);
    expect(source.attendantQueue).not.toHaveBeenCalled();
    expect(source.attendantWork).not.toHaveBeenCalled();
  });

  it.each([["ADMIN"], ["MANAGER"], ["REQUESTER"]])("refuses %s", async (role) => {
    authorization.requireCurrentActor.mockResolvedValue(actor(role));
    const source = reader();
    await expect(getAttendantDashboard({}, source, now)).rejects.toThrow(AuthorizationError);
    expect(source.findSector).not.toHaveBeenCalled();
  });

  it("reports a refused period and uses the default one", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ATTENDANT"));
    const result = await getAttendantDashboard({ period: "15" }, reader(), now);
    expect(result.periodError).toBe("invalid_option");
    expect(result.period.option).toBe("30");
  });
});

describe("getAnalytics (5.1, 5.4 to 5.6)", () => {
  it("gives the administrator the whole organization, with each person's sector", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const source = reader();
    const result = await getAnalytics({ period: "7" }, source, now);

    expect(source.dailyCounts).toHaveBeenCalledWith({ sectorId: null }, { from: result.period.from, before: result.period.before });
    expect(result).toMatchObject({ audience: "organization", sector: null, withoutSector: false, teamShowsSector: true, granularity: "day" });
    expect(result.trend).toHaveLength(7);
    expect(result.trend.at(-2)).toMatchObject({ label: "05/11", opened: 3, completed: 2, onTimePercentage: 50 });
    expect(result.team.map(({ name }) => name)).toEqual(["Ana", "Bruno"]);
  });

  it("uses the current instant as the end of the interval that has not ended", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const source = reader();
    await getAnalytics({ period: "7" }, source, now);
    const instants = vi.mocked(source.pendingAt).mock.calls[0]![1];
    expect(instants).toHaveLength(7);
    expect(instants.at(-1)).toEqual(now);
    expect(instants[0]!.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("filters one sector for the administrator and hides the sector column", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const source = reader();
    const result = await getAnalytics({ sector: central.id }, source, now);
    expect(source.team).toHaveBeenCalledWith({ sectorId: central.id }, expect.anything());
    expect(result).toMatchObject({ sector: { id: central.id, name: "Central" }, teamShowsSector: false });
  });

  it("refuses an unknown sector with a message and shows the organization", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const result = await getAnalytics({ sector: "99999999-9999-4999-8999-999999999999" }, reader(), now);
    expect(result.errors.sector).toBe("invalid_sector");
    expect(result.sector).toBeNull();
  });

  it("gives the manager only the current sector, ignoring a sector in the URL", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER"));
    const source = reader();
    const result = await getAnalytics({ sector: archive.id }, source, now);
    expect(source.team).toHaveBeenCalledWith({ sectorId: central.id }, expect.anything());
    expect(result).toMatchObject({ audience: "sector", sector: { name: "Central" }, teamShowsSector: false });
  });

  it("reads nothing for a manager without an active sector", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER", archive.id));
    const source = reader();
    const result = await getAnalytics({}, source, now);
    expect(result.withoutSector).toBe(true);
    expect(result.team).toEqual([]);
    expect(result.trend.every((point) => point.opened === 0)).toBe(true);
    for (const method of ["dailyCounts", "pendingAt", "firstResponse", "team", "arrivals"] as const) {
      expect(source[method]).not.toHaveBeenCalled();
    }
  });

  it.each([["ATTENDANT"], ["REQUESTER"]])("refuses %s before reading", async (role) => {
    authorization.requireCurrentActor.mockResolvedValue(actor(role));
    const source = reader();
    await expect(getAnalytics({}, source, now)).rejects.toThrow(AuthorizationError);
    expect(source.dailyCounts).not.toHaveBeenCalled();
  });

  it("formats the SLA block", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const { sla } = await getAnalytics({}, reader(), now);
    expect(sla.firstResponse).toEqual({ times: { averageHours: 2, medianHours: 1 }, answered: 5, unanswered: 2 });
    expect(sla.pauses).toEqual({ completed: 6, withPause: 2, times: { averageHours: 3, medianHours: 3 } });
    expect(sla.stages).toEqual([{ serviceName: "Reparo", stageName: "Triagem", count: 2, times: { averageHours: 1, medianHours: 1 } }]);
    expect(sla.onTimeByService).toEqual([{ label: "Reparo", withDueDate: 5, onTime: 4, percentage: 80, fewData: false }]);
    // Priorities keep their order, from the most urgent; empty ones are left out.
    expect(sla.onTimeByPriority.map(({ label, fewData }) => [label, fewData])).toEqual([
      ["Urgente", false],
      ["Baixa", true],
    ]);
    expect(sla.arrivals).toMatchObject({ total: 4, largest: 4 });
    expect(sla.arrivals.cells[2]![10]).toBe(4);
  });

  it("uses weeks for a 90-day period", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const result = await getAnalytics({ period: "90" }, reader(), now);
    expect(result.granularity).toBe("week");
    expect(result.trend.length).toBeGreaterThanOrEqual(13);
    expect(result.trend.length).toBeLessThanOrEqual(15);
  });
});
