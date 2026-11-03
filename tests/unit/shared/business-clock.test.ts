import { describe, expect, it } from "vitest";
import {
  addClockTime,
  CALENDAR_CLOCK,
  clockTimeBetween,
  isBusinessDay,
  NoBusinessTimeError,
  type BusinessCalendar,
  type SlaClock,
} from "@/shared/business-clock";

// SPEC 2026-11-03-pausa-sla-calendario, 5.2 (SF-128). São Paulo is UTC-3 all year: 08:00 there is
// 11:00Z. 2026-11-06 is a Friday; 2026-11-09 is the next Monday.

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const calendar: BusinessCalendar = {
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 8 * 60,
  endMinute: 18 * 60,
  timeZone: "America/Sao_Paulo",
  holidays: [],
};

const business = (overrides: Partial<BusinessCalendar> = {}): SlaClock => ({ kind: "business", calendar: { ...calendar, ...overrides } });
const at = (iso: string) => new Date(iso);

describe("business-hours clock (5.2)", () => {
  it("counts calendar hours exactly as before", () => {
    expect(addClockTime(at("2026-11-06T19:00:00Z"), 4 * HOUR, CALENDAR_CLOCK)).toEqual(at("2026-11-06T23:00:00Z"));
    expect(clockTimeBetween(at("2026-11-06T19:00:00Z"), at("2026-11-07T19:00:00Z"), CALENDAR_CLOCK)).toBe(24 * HOUR);
  });

  it("follows the example of the SPEC: 4 hours from Friday 16:00 end on Monday 10:00", () => {
    expect(addClockTime(at("2026-11-06T19:00:00Z"), 4 * HOUR, business())).toEqual(at("2026-11-09T13:00:00Z"));
  });

  it("starts at the next window when opened outside business hours", () => {
    // Saturday afternoon, Sunday and Monday before 08:00 all start Monday 08:00.
    for (const start of ["2026-11-07T18:00:00Z", "2026-11-08T12:00:00Z", "2026-11-09T09:30:00Z"]) {
      expect(addClockTime(at(start), 30 * MINUTE, business()), start).toEqual(at("2026-11-09T11:30:00Z"));
    }
    // Friday after 18:00.
    expect(addClockTime(at("2026-11-06T22:00:00Z"), HOUR, business())).toEqual(at("2026-11-09T12:00:00Z"));
  });

  it("ends at the end of a window, never in the gap after it", () => {
    expect(addClockTime(at("2026-11-06T11:00:00Z"), 10 * HOUR, business())).toEqual(at("2026-11-06T21:00:00Z"));
    expect(addClockTime(at("2026-11-06T11:00:00Z"), 10 * HOUR + 1, business())).toEqual(at("2026-11-09T11:00:00.001Z"));
  });

  it("skips single and yearly holidays, and a yearly 29/02 only in leap years", () => {
    const holidays = [
      { day: "2026-11-09", yearly: false },
      { day: "2020-11-10", yearly: true },
    ];
    // Monday and Tuesday are holidays: Friday 17:00 + 2 h ends Wednesday 09:00.
    expect(addClockTime(at("2026-11-06T20:00:00Z"), 2 * HOUR, business({ holidays }))).toEqual(at("2026-11-11T12:00:00Z"));
    expect(isBusinessDay("2026-11-10", { ...calendar, holidays })).toBe(false);
    expect(isBusinessDay("2026-11-11", { ...calendar, holidays })).toBe(true);

    const leap = { ...calendar, holidays: [{ day: "2024-02-29", yearly: true }] };
    expect(isBusinessDay("2028-02-29", leap)).toBe(false);
    expect(isBusinessDay("2027-03-01", leap)).toBe(true);
    expect(isBusinessDay("2027-02-26", leap)).toBe(true);
  });

  it("uses the calendar's time zone and a window that ends at midnight", () => {
    const lisbon = business({ timeZone: "Europe/Lisbon" });
    // Friday 2026-11-06 17:00 in Lisbon (UTC+0 in November) + 2 h ends Monday 09:00 Lisbon.
    expect(addClockTime(at("2026-11-06T17:00:00Z"), 2 * HOUR, lisbon)).toEqual(at("2026-11-09T09:00:00Z"));

    const lateShift = business({ startMinute: 20 * 60, endMinute: 1440 });
    // Friday 23:00 + 2 h: one hour on Friday until midnight, one from Monday 20:00 (23:00Z).
    expect(addClockTime(at("2026-11-07T02:00:00Z"), 2 * HOUR, lateShift)).toEqual(at("2026-11-10T00:00:00Z"));
  });

  it("measures business time between instants, signed", () => {
    const clock = business();
    expect(clockTimeBetween(at("2026-11-06T19:00:00Z"), at("2026-11-09T13:00:00Z"), clock)).toBe(4 * HOUR);
    expect(clockTimeBetween(at("2026-11-09T13:00:00Z"), at("2026-11-06T19:00:00Z"), clock)).toBe(-4 * HOUR);
    expect(clockTimeBetween(at("2026-11-07T12:00:00Z"), at("2026-11-08T12:00:00Z"), clock)).toBe(0);
    expect(clockTimeBetween(at("2026-11-02T11:00:00Z"), at("2026-11-09T11:00:00Z"), clock)).toBe(50 * HOUR);
  });

  it("goes back to the earliest instant with the same business time ahead", () => {
    const clock = business();
    expect(addClockTime(at("2026-11-09T13:00:00Z"), -4 * HOUR, clock)).toEqual(at("2026-11-06T19:00:00Z"));
    // Exactly the whole Monday morning back from Monday 10:00: the business time ahead is the same
    // from Friday 18:00 on, so the answer is Friday 18:00.
    expect(addClockTime(at("2026-11-09T13:00:00Z"), -2 * HOUR, clock)).toEqual(at("2026-11-06T21:00:00Z"));
  });

  it("adding and then measuring give back the same amount", () => {
    const clock = business({ holidays: [{ day: "2026-12-25", yearly: true }] });
    const start = at("2026-12-23T15:17:00Z");
    for (const amount of [MINUTE, 3 * HOUR, 25 * HOUR, 400 * HOUR]) {
      const end = addClockTime(start, amount, clock);
      expect(clockTimeBetween(start, end, clock), String(amount)).toBe(amount);
    }
  });

  it("gives up when the calendar has no business time", () => {
    const allHolidays = Array.from({ length: 366 }, (_, index) => {
      const day = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
      return { day, yearly: true };
    });
    expect(() => addClockTime(at("2026-11-06T12:00:00Z"), HOUR, business({ holidays: allHolidays }))).toThrow(NoBusinessTimeError);
  });
});
