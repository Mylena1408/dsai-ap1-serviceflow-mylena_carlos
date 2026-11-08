import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import {
  assertScheduleDates,
  dueOccurrence,
  frequencyText,
  matchesFrequency,
  nextOccurrence,
  scheduleInputSchema,
  scheduleStatus,
  type ScheduleTiming,
} from "@/modules/recurring-requests";

// SPEC 2026-11-07-operacao-e-automacao, 5.3 items 2 and 3 (SF-184; CA-REC-02 and 03 by the rules).

const S = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const base = { name: "Limpeza do ar", serviceId: S, requesterId: R, description: "Manutenção preventiva", startsOn: "2026-11-09" };

// 2026-11-09 is a Monday.
const weekly = (overrides: Partial<ScheduleTiming> = {}): ScheduleTiming => ({
  frequency: "WEEKLY",
  weekdays: [1, 3],
  monthDay: null,
  startsOn: "2026-11-09",
  endsOn: null,
  ...overrides,
});
const monthly = (overrides: Partial<ScheduleTiming> = {}): ScheduleTiming => ({
  frequency: "MONTHLY",
  weekdays: [],
  monthDay: 10,
  startsOn: "2026-11-09",
  endsOn: null,
  ...overrides,
});

describe("schedule input (5.3 item 2)", () => {
  it("reads a weekly schedule, sorting the weekdays and dropping the month day", () => {
    expect(scheduleInputSchema.parse({ ...base, frequency: "WEEKLY", weekdays: ["3", "1", "3"], monthDay: "5", answers: { f: "x" } })).toEqual({
      ...base,
      answers: { f: "x" },
      frequency: "WEEKLY",
      weekdays: [1, 3],
      monthDay: null,
      endsOn: null,
    });
  });

  it("reads a monthly schedule, dropping the weekdays", () => {
    expect(scheduleInputSchema.parse({ ...base, frequency: "MONTHLY", weekdays: ["1"], monthDay: "28", endsOn: " 2027-11-09 " })).toMatchObject({
      weekdays: [],
      monthDay: 28,
      endsOn: "2027-11-09",
      answers: {},
    });
  });

  it("refuses what the rules do not allow", () => {
    for (const input of [
      { ...base, frequency: "WEEKLY" },
      { ...base, frequency: "WEEKLY", weekdays: ["8"] },
      { ...base, frequency: "MONTHLY", monthDay: "" },
      { ...base, frequency: "MONTHLY", monthDay: "29" },
      { ...base, frequency: "DAILY" },
      { ...base, name: "", frequency: "MONTHLY", monthDay: 1 },
      { ...base, name: "x".repeat(81), frequency: "MONTHLY", monthDay: 1 },
      { ...base, description: " ", frequency: "MONTHLY", monthDay: 1 },
      { ...base, startsOn: "09/11/2026", frequency: "MONTHLY", monthDay: 1 },
      { ...base, frequency: "MONTHLY", monthDay: 1, endsOn: "31/12/2026" },
      { ...base, frequency: "MONTHLY", monthDay: 1, extra: true },
    ]) {
      expect(scheduleInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("starts today or later and ends within two years of the start", () => {
    expect(() => assertScheduleDates({ startsOn: "2026-11-07", endsOn: null }, "2026-11-07")).not.toThrow();
    expect(() => assertScheduleDates({ startsOn: "2026-11-06", endsOn: null }, "2026-11-07")).toThrow(ValidationError);
    expect(() => assertScheduleDates({ startsOn: "2026-11-09", endsOn: "2026-11-08" }, "2026-11-07")).toThrow(ValidationError);
    expect(() => assertScheduleDates({ startsOn: "2026-11-09", endsOn: "2028-11-09" }, "2026-11-07")).not.toThrow();
    expect(() => assertScheduleDates({ startsOn: "2026-11-09", endsOn: "2028-11-10" }, "2026-11-07")).toThrow(ValidationError);
  });
});

describe("the schedule's days (5.3 item 3)", () => {
  it("matches the weekdays or the month day", () => {
    expect(matchesFrequency(weekly(), "2026-11-09")).toBe(true); // Monday
    expect(matchesFrequency(weekly(), "2026-11-11")).toBe(true); // Wednesday
    expect(matchesFrequency(weekly(), "2026-11-10")).toBe(false);
    expect(matchesFrequency(monthly(), "2026-12-10")).toBe(true);
    expect(matchesFrequency(monthly(), "2026-12-11")).toBe(false);
  });

  it("finds the next day within the period", () => {
    expect(nextOccurrence(weekly(), "2026-11-07")).toBe("2026-11-09");
    expect(nextOccurrence(weekly(), "2026-11-10")).toBe("2026-11-11");
    expect(nextOccurrence(monthly(), "2026-11-07")).toBe("2026-11-10");
    expect(nextOccurrence(monthly(), "2026-11-11")).toBe("2026-12-10");
    expect(nextOccurrence(monthly({ endsOn: "2026-12-01" }), "2026-11-11")).toBeNull();
  });

  it("runs only the latest day up to today that has not run (decision H10)", () => {
    // Wednesday the 11th: Monday the 9th is older and is not recovered.
    expect(dueOccurrence(weekly(), "2026-11-11", null)).toBe("2026-11-11");
    expect(dueOccurrence(weekly(), "2026-11-12", null)).toBe("2026-11-11");
    expect(dueOccurrence(weekly(), "2026-11-12", "2026-11-11")).toBeNull();
    expect(dueOccurrence(weekly(), "2026-11-16", "2026-11-11")).toBe("2026-11-16");
    expect(dueOccurrence(weekly(), "2026-11-08", null)).toBeNull(); // before the start
    expect(dueOccurrence(monthly(), "2026-12-15", "2026-11-10")).toBe("2026-12-10");
    // After the end, the last day of the period still counts once.
    expect(dueOccurrence(monthly({ endsOn: "2026-12-12" }), "2027-01-20", "2026-11-10")).toBe("2026-12-10");
    expect(dueOccurrence(monthly({ endsOn: "2026-12-12" }), "2027-01-20", "2026-12-10")).toBeNull();
  });

  it("describes the frequency and the state", () => {
    expect(frequencyText(weekly())).toBe("Semanal: segunda e quarta");
    expect(frequencyText(weekly({ weekdays: [6] }))).toBe("Semanal: sábado");
    expect(frequencyText(weekly({ weekdays: [1, 2, 3, 4, 5, 6, 7] }))).toBe("Diária");
    expect(frequencyText(monthly())).toBe("Mensal: dia 10");
    expect(scheduleStatus({ pausedAt: null, endedAt: null, endsOn: null }, "2026-11-07")).toBe("active");
    expect(scheduleStatus({ pausedAt: new Date(), endedAt: null, endsOn: null }, "2026-11-07")).toBe("paused");
    expect(scheduleStatus({ pausedAt: null, endedAt: new Date(), endsOn: null }, "2026-11-07")).toBe("ended");
    expect(scheduleStatus({ pausedAt: null, endedAt: null, endsOn: "2026-11-06" }, "2026-11-07")).toBe("finished");
  });
});
