import { describe, expect, it } from "vitest";
import { lastDaysPeriod, parseReportPeriod } from "@/modules/reports";
import { addDays, daysBetweenInclusive, zonedDateTimeOf, zonedDayOf } from "@/shared/time";

// SPEC 2026-11-02-painel-relatorios, 5.2 (SF-097; CA-DASH-04 and CA-DASH-07).

// 2026-11-02 00:30 in São Paulo (UTC-3) is still 2026-11-02 03:30 UTC; 01:30 UTC is 11-01 there.
const now = new Date("2026-11-02T15:00:00.000Z");

describe("calendar days in São Paulo", () => {
  it("reads the day and time of an instant in São Paulo, not in UTC", () => {
    expect(zonedDayOf(new Date("2026-11-02T02:59:00.000Z"))).toBe("2026-11-01");
    expect(zonedDayOf(new Date("2026-11-02T03:00:00.000Z"))).toBe("2026-11-02");
    expect(zonedDateTimeOf(new Date("2026-11-02T02:59:30.000Z"))).toBe("2026-11-01 23:59");
  });

  it("counts days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetweenInclusive("2026-11-02", "2026-11-02")).toBe(1);
    expect(daysBetweenInclusive("2026-01-01", "2026-12-31")).toBe(365);
  });
});

describe("dashboard period (CA-DASH-07)", () => {
  it("defaults to the last 30 days, today included, bounded by midnights in São Paulo", () => {
    const { period, error } = parseReportPeriod({}, now);

    expect(error).toBeNull();
    expect(period).toEqual({
      option: "30",
      firstDay: "2026-10-04",
      lastDay: "2026-11-02",
      from: new Date("2026-10-04T03:00:00.000Z"),
      before: new Date("2026-11-03T03:00:00.000Z"),
    });
  });

  it("offers the last 7 and 90 days", () => {
    expect(parseReportPeriod({ period: "7" }, now)).toMatchObject({
      period: { option: "7", firstDay: "2026-10-27", lastDay: "2026-11-02" },
      error: null,
    });
    expect(parseReportPeriod({ period: "90" }, now).period).toMatchObject({ firstDay: "2026-08-05", lastDay: "2026-11-02" });
    expect(daysBetweenInclusive(lastDaysPeriod(90, now).firstDay, lastDaysPeriod(90, now).lastDay)).toBe(90);
  });

  it("uses today in São Paulo near midnight (CA-DASH-04)", () => {
    const lateEvening = new Date("2026-11-02T02:30:00.000Z"); // 2026-11-01 23:30 in São Paulo

    expect(lastDaysPeriod(7, lateEvening)).toMatchObject({ firstDay: "2026-10-26", lastDay: "2026-11-01" });
  });

  it("accepts a range of days, both included, up to 366 days and not after today", () => {
    expect(parseReportPeriod({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, now)).toEqual({
      period: {
        option: "custom",
        firstDay: "2026-10-01",
        lastDay: "2026-10-31",
        from: new Date("2026-10-01T03:00:00.000Z"),
        before: new Date("2026-11-01T03:00:00.000Z"),
      },
      error: null,
    });
    expect(parseReportPeriod({ period: "custom", from: "2025-11-02", to: "2026-11-02" }, now).error).toBeNull();
    expect(parseReportPeriod({ period: "custom", from: "2026-11-02", to: "2026-11-02" }, now).error).toBeNull();
  });

  it.each([
    [{ period: "15" }, "invalid_option"],
    [{ period: "custom" }, "missing_dates"],
    [{ period: "custom", from: "2026-10-01" }, "missing_dates"],
    [{ period: "custom", from: "01/10/2026", to: "2026-10-31" }, "invalid_date"],
    [{ period: "custom", from: "2026-02-30", to: "2026-03-01" }, "invalid_date"],
    [{ period: "custom", from: "2026-10-31", to: "2026-10-01" }, "inverted_range"],
    [{ period: "custom", from: "2026-10-01", to: "2026-11-03" }, "future_date"],
    [{ period: "custom", from: "2025-11-01", to: "2026-11-02" }, "too_long"],
  ])("refuses %o with %s and falls back to the last 30 days", (raw, code) => {
    const result = parseReportPeriod(raw, now);

    expect(result.error).toBe(code);
    expect(result.period).toEqual(lastDaysPeriod(30, now));
  });

  it("ignores dates without the custom option and takes the first of repeated values", () => {
    expect(parseReportPeriod({ period: "7", from: "2026-01-01", to: "2026-01-31" }, now).period.firstDay).toBe("2026-10-27");
    expect(parseReportPeriod({ period: ["90", "7"] }, now).period.option).toBe("90");
  });
});
