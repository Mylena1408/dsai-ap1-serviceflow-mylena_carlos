import { describe, expect, it } from "vitest";
import { minuteOfTime, parseCalendarInput, parseHolidayInput, timeOfMinute } from "@/modules/calendar";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-03-pausa-sla-calendario, 5.1 (SF-128).

function issues(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues.map(({ path, code }) => `${path.join(".")}:${code}`);
    throw error;
  }
  return [];
}

describe("business calendar settings (5.1)", () => {
  it("accepts weekdays, a window and a known time zone", () => {
    expect(parseCalendarInput({ weekdays: ["5", "1", "3", "1"], startTime: "07:30", endTime: "24:00", timeZone: " America/Belem " })).toEqual({
      weekdays: [1, 3, 5],
      startMinute: 450,
      endMinute: 1440,
      timeZone: "America/Belem",
    });
    expect(parseCalendarInput({ weekdays: "6", startTime: "00:00", endTime: "00:01", timeZone: "UTC" }).weekdays).toEqual([6]);
  });

  it("reports every invalid field", () => {
    expect(issues(() => parseCalendarInput({ weekdays: [], startTime: "8h", endTime: "25:00", timeZone: "Lua/Base" }))).toEqual([
      "weekdays:invalid_value",
      "startTime:invalid_format",
      "endTime:invalid_format",
      "timeZone:invalid_value",
    ]);
    expect(issues(() => parseCalendarInput({ weekdays: ["8"], startTime: "18:00", endTime: "08:00", timeZone: "America/Sao_Paulo" }))).toEqual([
      "weekdays:invalid_value",
      "endTime:invalid_value",
    ]);
    expect(issues(() => parseCalendarInput({ weekdays: ["1"], startTime: "08:00", endTime: "08:00", timeZone: "America/Sao_Paulo" }))).toEqual([
      "endTime:invalid_value",
    ]);
    expect(issues(() => parseCalendarInput({ weekdays: ["1"], startTime: "24:00", endTime: "00:00", timeZone: "" }))).toEqual([
      "startTime:invalid_format",
      "endTime:invalid_format",
      "timeZone:invalid_value",
    ]);
  });

  it("reads and writes times of the day", () => {
    expect(minuteOfTime("08:05")).toBe(485);
    expect(minuteOfTime("24:00")).toBe(1440);
    expect(minuteOfTime("8:05")).toBeNull();
    expect(timeOfMinute(485)).toBe("08:05");
    expect(timeOfMinute(1440)).toBe("24:00");
  });
});

describe("holidays (5.1 item 2)", () => {
  it("accepts a calendar day and a trimmed name", () => {
    expect(parseHolidayInput({ day: "2026-12-25", name: "  Natal ", yearly: "on" })).toEqual({ day: "2026-12-25", name: "Natal", yearly: true });
    expect(parseHolidayInput({ day: "2027-03-01", name: "Ponto facultativo" }).yearly).toBe(false);
  });

  it("refuses invalid dates and names", () => {
    expect(issues(() => parseHolidayInput({ day: "2026-02-30", name: "" }))).toEqual(["day:invalid_format", "name:too_small"]);
    expect(issues(() => parseHolidayInput({ day: "25/12/2026", name: "n".repeat(81) }))).toEqual(["day:invalid_format", "name:too_big"]);
  });
});
