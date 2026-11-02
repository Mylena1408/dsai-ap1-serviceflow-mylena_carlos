import { describe, expect, it } from "vitest";
import {
  barPercentage,
  completionTimes,
  completionTimesFromAggregate,
  onTimePercentage,
  sortReportGroups,
} from "@/modules/reports/domain/metrics";

// SPEC 2026-11-02-painel-relatorios, 5.3 and 5.5 (SF-097; CA-DASH-05 and CA-DASH-06).

const HOUR = 60 * 60 * 1000;

describe("time to completion (CA-DASH-05)", () => {
  it("gives the average and the median in hours, with one decimal place", () => {
    expect(completionTimes([2 * HOUR, 4 * HOUR, 30 * HOUR])).toEqual({ averageHours: 12, medianHours: 4 });
    expect(completionTimes([1 * HOUR, 2 * HOUR, 3 * HOUR, 10 * HOUR])).toEqual({ averageHours: 4, medianHours: 2.5 });
    expect(completionTimes([90 * 60 * 1000 + 3 * 60 * 1000])).toEqual({ averageHours: 1.6, medianHours: 1.6 });
  });

  it("does not depend on the order of the durations", () => {
    expect(completionTimes([30 * HOUR, 2 * HOUR, 4 * HOUR])).toEqual(completionTimes([2 * HOUR, 4 * HOUR, 30 * HOUR]));
  });

  it("has nothing to show without completed requests", () => {
    expect(completionTimes([])).toBeNull();
  });

  it("rounds an average and a median computed by the database the same way (SF-098)", () => {
    expect(completionTimesFromAggregate({ averageMs: 4 * HOUR, medianMs: 2.5 * HOUR })).toEqual(
      completionTimes([1 * HOUR, 2 * HOUR, 3 * HOUR, 10 * HOUR]),
    );
    expect(completionTimesFromAggregate({ averageMs: 93 * 60 * 1000, medianMs: 93 * 60 * 1000 })).toEqual({
      averageHours: 1.6,
      medianHours: 1.6,
    });
    expect(completionTimesFromAggregate(null)).toBeNull();
  });
});

describe("completed on time (CA-DASH-05)", () => {
  it("is the whole percentage of the completed requests with a due date", () => {
    expect(onTimePercentage(3, 4)).toBe(75);
    expect(onTimePercentage(2, 3)).toBe(67);
    expect(onTimePercentage(0, 5)).toBe(0);
    expect(onTimePercentage(5, 5)).toBe(100);
  });

  it("has nothing to show when no completed request had a due date", () => {
    expect(onTimePercentage(0, 0)).toBeNull();
  });
});

describe("groups (CA-DASH-06)", () => {
  it("puts the largest group first and breaks ties by name", () => {
    expect(
      sortReportGroups([
        { label: "Manutenção", count: 2 },
        { label: "Tecnologia", count: 5 },
        { label: "Acesso", count: 2 },
        { label: "Recursos humanos", count: 3 },
      ]),
    ).toEqual([
      { label: "Tecnologia", count: 5 },
      { label: "Recursos humanos", count: 3 },
      { label: "Acesso", count: 2 },
      { label: "Manutenção", count: 2 },
    ]);
  });

  it("orders names as people read them, accents and case included", () => {
    expect(sortReportGroups([{ label: "Ética", count: 1 }, { label: "elétrica", count: 1 }, { label: "Zelo", count: 1 }]).map((group) => group.label)).toEqual(["elétrica", "Ética", "Zelo"]);
  });

  it("does not change the groups it receives", () => {
    const groups = [{ label: "B", count: 1 }, { label: "A", count: 2 }];
    sortReportGroups(groups);
    expect(groups[0].label).toBe("B");
  });

  it("sizes the bars against the largest group", () => {
    expect(barPercentage(5, 5)).toBe(100);
    expect(barPercentage(2, 3)).toBe(67);
    expect(barPercentage(0, 0)).toBe(0);
  });
});
