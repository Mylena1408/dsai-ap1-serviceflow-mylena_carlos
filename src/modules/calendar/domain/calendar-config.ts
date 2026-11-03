import { ValidationError, type ValidationIssue } from "@/server/errors";
import { MINUTES_PER_DAY } from "@/shared/business-clock";
import { calendarDayError, isKnownTimeZone } from "@/shared/time";

export { DEFAULT_CALENDAR, MINUTES_PER_DAY, WEEKDAY_LABELS, timeOfMinute } from "@/shared/business-clock";

// Business calendar and holidays (SPEC 2026-11-03-pausa-sla-calendario, 5.1 and 6).

export const MAX_HOLIDAY_NAME_LENGTH = 80;

export interface CalendarSettings {
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  timeZone: string;
}

export interface CalendarInput {
  weekdays?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  timeZone?: unknown;
}

export interface HolidaySettings {
  day: string;
  name: string;
  yearly: boolean;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" as minutes of the day; "24:00" is the end of the day. Null when not a time. */
export function minuteOfTime(raw: unknown): number | null {
  if (typeof raw !== "string") {
    return null;
  }

  const text = raw.trim();

  if (text === "24:00") {
    return MINUTES_PER_DAY;
  }

  const match = TIME_PATTERN.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function parseWeekdays(raw: unknown): number[] | null {
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const days = new Set<number>();

  for (const value of values) {
    const day = typeof value === "number" ? value : typeof value === "string" && /^[1-7]$/.test(value.trim()) ? Number(value) : NaN;

    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return null;
    }

    days.add(day);
  }

  return days.size === 0 ? null : [...days].sort((a, b) => a - b);
}

/**
 * Section 5.1 item 1: one or more weekdays, a window whose start comes before its end, and an
 * IANA time zone. Every problem is reported at once, on the field that has it.
 */
export function parseCalendarInput(input: CalendarInput): CalendarSettings {
  const issues: ValidationIssue[] = [];
  const weekdays = parseWeekdays(input.weekdays);
  const startMinute = input.startTime === "24:00" ? null : minuteOfTime(input.startTime);
  const endMinute = minuteOfTime(input.endTime);
  const timeZone = typeof input.timeZone === "string" ? input.timeZone.trim() : "";

  if (weekdays === null) {
    issues.push({ path: ["weekdays"], code: "invalid_value" });
  }

  if (startMinute === null) {
    issues.push({ path: ["startTime"], code: "invalid_format" });
  }

  if (endMinute === null || endMinute === 0) {
    issues.push({ path: ["endTime"], code: "invalid_format" });
  } else if (startMinute !== null && startMinute >= endMinute) {
    issues.push({ path: ["endTime"], code: "invalid_value" });
  }

  if (!isKnownTimeZone(timeZone)) {
    issues.push({ path: ["timeZone"], code: "invalid_value" });
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return { weekdays: weekdays!, startMinute: startMinute!, endMinute: endMinute!, timeZone };
}

/** Section 5.1 item 2: a calendar day, a name of 1 to 80 characters once trimmed, yearly or not. */
export function parseHolidayInput(input: { day?: unknown; name?: unknown; yearly?: unknown }): HolidaySettings {
  const issues: ValidationIssue[] = [];
  const day = typeof input.day === "string" ? input.day.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";

  if (calendarDayError(day) !== null) {
    issues.push({ path: ["day"], code: "invalid_format" });
  }

  if (name === "") {
    issues.push({ path: ["name"], code: "too_small" });
  } else if ([...name].length > MAX_HOLIDAY_NAME_LENGTH) {
    issues.push({ path: ["name"], code: "too_big" });
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return { day, name, yearly: input.yearly === true || input.yearly === "on" || input.yearly === "true" };
}
