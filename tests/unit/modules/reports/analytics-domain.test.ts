import { describe, expect, it } from "vitest";
import {
  analyticsGranularity,
  analyticsIntervals,
  arrivalGrid,
  durationTimes,
  intensityStep,
  intervalIndexOfDay,
  onTimeGroups,
  stageTimes,
  teamTable,
  trendSeries,
  type TeamMemberRow,
} from "@/modules/reports/domain/analytics";

// SPEC 2026-11-06-analises-operacionais, 5.2 to 5.6 (SF-144).

const HOUR = 3_600_000;
const period = (firstDay: string, lastDay: string) => ({ firstDay, lastDay });

describe("intervals of the series (5.2)", () => {
  it("uses days up to 31 days and weeks above", () => {
    expect(analyticsGranularity(period("2026-10-07", "2026-11-06"))).toBe("day");
    expect(analyticsGranularity(period("2026-10-06", "2026-11-06"))).toBe("week");
    expect(analyticsGranularity(period("2026-11-06", "2026-11-06"))).toBe("day");
  });

  it("makes one interval per São Paulo day, from local midnight to the next", () => {
    const intervals = analyticsIntervals(period("2026-11-04", "2026-11-06"));
    expect(intervals.map(({ label }) => label)).toEqual(["04/11", "05/11", "06/11"]);
    // São Paulo is UTC-3 (no daylight saving since 2019).
    expect(intervals[0]!.start.toISOString()).toBe("2026-11-04T03:00:00.000Z");
    expect(intervals[0]!.end.toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(intervals[2]!.end.toISOString()).toBe("2026-11-07T03:00:00.000Z");
  });

  it("makes Monday-to-Sunday weeks, partial at both ends", () => {
    // 2026-08-08 is a Saturday; 2026-11-06 is a Friday.
    const intervals = analyticsIntervals(period("2026-08-08", "2026-11-06"));
    expect(intervals[0]).toMatchObject({ firstDay: "2026-08-08", lastDay: "2026-08-09", label: "08/08–09/08" });
    expect(intervals[1]).toMatchObject({ firstDay: "2026-08-10", lastDay: "2026-08-16" });
    expect(intervals.at(-1)).toMatchObject({ firstDay: "2026-11-02", lastDay: "2026-11-06", label: "02/11–06/11" });
    for (let index = 1; index < intervals.length; index += 1) {
      expect(intervals[index]!.start).toEqual(intervals[index - 1]!.end);
    }
  });

  it("covers a 366-day period with at most 54 weeks", () => {
    const intervals = analyticsIntervals(period("2025-11-06", "2026-11-06"));
    expect(intervals.length).toBeLessThanOrEqual(54);
    expect(intervals[0]!.firstDay).toBe("2025-11-06");
    expect(intervals.at(-1)!.lastDay).toBe("2026-11-06");
  });

  it("finds the interval of a day", () => {
    const intervals = analyticsIntervals(period("2026-08-08", "2026-11-06"));
    expect(intervalIndexOfDay(intervals, "2026-08-09")).toBe(0);
    expect(intervalIndexOfDay(intervals, "2026-08-10")).toBe(1);
    expect(intervalIndexOfDay(intervals, "2026-11-07")).toBe(-1);
  });
});

describe("trendSeries (5.4)", () => {
  const intervals = analyticsIntervals(period("2026-08-08", "2026-08-20"));

  it("folds daily counts into intervals and keeps the pending counts", () => {
    const points = trendSeries(
      intervals,
      [
        { day: "2026-08-08", opened: 2, completed: 1, withDueDate: 1, onTime: 1 },
        { day: "2026-08-09", opened: 1, completed: 3, withDueDate: 2, onTime: 1 },
        { day: "2026-08-12", opened: 4, completed: 0, withDueDate: 0, onTime: 0 },
        { day: "2026-09-01", opened: 99, completed: 99, withDueDate: 99, onTime: 99 },
      ],
      [5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    );
    expect(points[0]).toMatchObject({ label: "08/08", opened: 2, completed: 1, pendingAtEnd: 5, onTimePercentage: 100 });
    expect(points[1]).toMatchObject({ opened: 1, completed: 3, withDueDate: 2, onTimePercentage: 50 });
    expect(points[2]).toMatchObject({ opened: 0, completed: 0, onTimePercentage: null });
    expect(points[4]).toMatchObject({ opened: 4 });
    expect(points.reduce((sum, point) => sum + point.opened, 0)).toBe(7);
  });

  it("returns a point per interval even without data", () => {
    const points = trendSeries(intervals, [], []);
    expect(points).toHaveLength(intervals.length);
    expect(points.every((point) => point.opened === 0 && point.pendingAtEnd === 0 && point.onTimePercentage === null)).toBe(true);
  });
});

describe("onTimeGroups (5.5.4)", () => {
  it("drops groups without a due date, marks few data and orders by volume then name", () => {
    expect(
      onTimeGroups([
        { label: "Reparo", withDueDate: 2, onTime: 1 },
        { label: "Acesso", withDueDate: 10, onTime: 9 },
        { label: "Sem prazo", withDueDate: 0, onTime: 0 },
        { label: "Banco", withDueDate: 2, onTime: 2 },
      ]),
    ).toEqual([
      { label: "Acesso", withDueDate: 10, onTime: 9, percentage: 90, fewData: false },
      { label: "Banco", withDueDate: 2, onTime: 2, percentage: 100, fewData: true },
      { label: "Reparo", withDueDate: 2, onTime: 1, percentage: 50, fewData: true },
    ]);
  });

  it("keeps the given order when asked", () => {
    const groups = onTimeGroups(
      [
        { label: "Urgente", withDueDate: 1, onTime: 0 },
        { label: "Normal", withDueDate: 5, onTime: 5 },
      ],
      "given",
    );
    expect(groups.map(({ label }) => label)).toEqual(["Urgente", "Normal"]);
  });

  it("starts counting as enough data at three", () => {
    expect(onTimeGroups([{ label: "A", withDueDate: 3, onTime: 2 }])[0]).toMatchObject({ fewData: false, percentage: 67 });
  });
});

describe("durationTimes", () => {
  it("turns milliseconds into hours with one decimal place", () => {
    expect(durationTimes({ count: 2, averageMs: 1.25 * HOUR, medianMs: 1.04 * HOUR })).toEqual({ averageHours: 1.3, medianHours: 1 });
  });

  it("gives null without data", () => {
    expect(durationTimes({ count: 0, averageMs: null, medianMs: null })).toBeNull();
    expect(durationTimes({ count: 3, averageMs: null, medianMs: 1 })).toBeNull();
  });
});

describe("arrivalGrid and intensityStep (5.5.5)", () => {
  it("places counts by ISO weekday and hour, ignoring invalid cells", () => {
    const grid = arrivalGrid([
      { isoWeekday: 1, hour: 0, count: 2 },
      { isoWeekday: 7, hour: 23, count: 5 },
      { isoWeekday: 1, hour: 0, count: 1 },
      { isoWeekday: 8, hour: 1, count: 9 },
      { isoWeekday: 2, hour: 24, count: 9 },
    ]);
    expect(grid.cells).toHaveLength(7);
    expect(grid.cells.every((row) => row.length === 24)).toBe(true);
    expect(grid.cells[0]![0]).toBe(3);
    expect(grid.cells[6]![23]).toBe(5);
    expect(grid).toMatchObject({ largest: 5, total: 8 });
  });

  it("gives an empty grid without data", () => {
    expect(arrivalGrid([])).toMatchObject({ largest: 0, total: 0 });
  });

  it("maps counts to steps 0 to 5, never showing a non-empty cell as empty", () => {
    expect(intensityStep(0, 10)).toBe(0);
    expect(intensityStep(1, 100)).toBe(1);
    expect(intensityStep(50, 100)).toBe(3);
    expect(intensityStep(100, 100)).toBe(5);
    expect(intensityStep(3, 0)).toBe(0);
  });
});

describe("teamTable (5.6)", () => {
  const row = (overrides: Partial<TeamMemberRow>): TeamMemberRow => ({
    userId: "u",
    name: "Pessoa",
    isActive: true,
    sectorName: "Central",
    completed: 0,
    completion: { count: 0, averageMs: null, medianMs: null },
    withDueDate: 0,
    onTime: 0,
    pendingNow: 0,
    ...overrides,
  });

  it("orders alphabetically, never by numbers, and leaves out people without anything", () => {
    const table = teamTable([
      row({ userId: "3", name: "Carla", completed: 1, completion: { count: 1, averageMs: 2 * HOUR, medianMs: 2 * HOUR }, withDueDate: 1, onTime: 1 }),
      row({ userId: "1", name: "ana", completed: 9, completion: { count: 9, averageMs: HOUR, medianMs: HOUR } }),
      row({ userId: "2", name: "Bruno", pendingNow: 4 }),
      row({ userId: "4", name: "Zeca" }),
    ]);
    expect(table.map(({ name }) => name)).toEqual(["ana", "Bruno", "Carla"]);
    expect(table[1]).toMatchObject({ completed: 0, completion: null, onTimePercentage: null, pendingNow: 4 });
    expect(table[2]).toMatchObject({ completion: { averageHours: 2, medianHours: 2 }, onTimePercentage: 100 });
  });

  it("breaks name ties by id, so the order is stable", () => {
    const table = teamTable([row({ userId: "b", name: "Ana", pendingNow: 1 }), row({ userId: "a", name: "Ana", pendingNow: 1 })]);
    expect(table.map(({ userId }) => userId)).toEqual(["a", "b"]);
  });
});

describe("stageTimes (5.5.2)", () => {
  it("orders by service, then by the position of the stage in the flow", () => {
    const duration = { count: 2, averageMs: HOUR, medianMs: HOUR };
    const result = stageTimes([
      { serviceName: "Reparo", stageName: "Execução", stageOrder: 2, duration },
      { serviceName: "Acesso", stageName: "Liberação", stageOrder: 1, duration },
      { serviceName: "Reparo", stageName: "Triagem", stageOrder: 1, duration },
    ]);
    expect(result.map(({ serviceName, stageName }) => `${serviceName} · ${stageName}`)).toEqual([
      "Acesso · Liberação",
      "Reparo · Triagem",
      "Reparo · Execução",
    ]);
    expect(result[0]).toMatchObject({ count: 2, times: { averageHours: 1, medianHours: 1 } });
  });
});
