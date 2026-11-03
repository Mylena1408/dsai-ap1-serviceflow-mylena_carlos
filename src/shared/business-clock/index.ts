import { addDays, isoWeekdayOf, zonedDayOf, zonedInstantOf } from "@/shared/time";

// The clock of a request's SLA (SPEC 2026-11-03-pausa-sla-calendario, 5.2). Calendar hours count
// every millisecond (the SLA SPEC, decision S1); business hours count only the daily window of the
// business days that are not holidays, in the calendar's time zone.

export interface Holiday {
  /** YYYY-MM-DD. */
  day: string;
  /** Repeats on the same day and month every year; a yearly 29/02 falls only in leap years. */
  yearly: boolean;
}

export interface BusinessCalendar {
  /** ISO weekdays, 1 = Monday to 7 = Sunday. */
  weekdays: readonly number[];
  /** Window of the day, in minutes: 0 <= start < end <= 1440. */
  startMinute: number;
  endMinute: number;
  timeZone: string;
  holidays: readonly Holiday[];
}

export type SlaClock = { kind: "calendar" } | { kind: "business"; calendar: BusinessCalendar };

export const CALENDAR_CLOCK: SlaClock = { kind: "calendar" };

export const MINUTES_PER_DAY = 1440;

/** Section 5.1: Monday to Friday, 08:00 to 18:00, São Paulo. It applies while no row was saved. */
export const DEFAULT_CALENDAR = {
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 8 * 60,
  endMinute: 18 * 60,
  timeZone: "America/Sao_Paulo",
} as const;

/** ISO weekdays as people read them, Monday first. */
export const WEEKDAY_LABELS: Readonly<Record<number, string>> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
  7: "Domingo",
};

/** Minutes of the day as "HH:MM"; 1440 is "24:00". */
export function timeOfMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The audit trail needs a uuid; the calendar is a single row with id 1 (SPEC 2026-11-03, 5.9). */
export const BUSINESS_CALENDAR_AUDIT_ID = "00000000-0000-4000-8000-000000000001";

/** How far the business clock looks for business time before giving up (section 9). */
const MAX_SEARCH_DAYS = 366 * 20;

export class NoBusinessTimeError extends Error {
  constructor() {
    super("The business calendar has no business time within the search limit.");
    this.name = "NoBusinessTimeError";
  }
}

interface Window {
  start: number;
  end: number;
}

function windowsOf(calendar: BusinessCalendar) {
  const weekdays = new Set(calendar.weekdays);
  const singleDays = new Set(calendar.holidays.filter(({ yearly }) => !yearly).map(({ day }) => day));
  const yearlyDays = new Set(calendar.holidays.filter(({ yearly }) => yearly).map(({ day }) => day.slice(5)));

  return (day: string): Window | null => {
    if (!weekdays.has(isoWeekdayOf(day)) || singleDays.has(day) || yearlyDays.has(day.slice(5))) {
      return null;
    }

    const start = zonedInstantOf(day, calendar.startMinute, calendar.timeZone).getTime();
    const end =
      calendar.endMinute === 1440
        ? zonedInstantOf(addDays(day, 1), 0, calendar.timeZone).getTime()
        : zonedInstantOf(day, calendar.endMinute, calendar.timeZone).getTime();
    return { start, end };
  };
}

/** Whether the calendar day of a holiday list is a business day (used by the screens and tests). */
export function isBusinessDay(day: string, calendar: BusinessCalendar): boolean {
  return windowsOf(calendar)(day) !== null;
}

function addBusiness(start: number, amount: number, calendar: BusinessCalendar): number {
  const windowOf = windowsOf(calendar);
  let day = zonedDayOf(new Date(start), calendar.timeZone);
  let remaining = amount;

  for (let step = 0; step < MAX_SEARCH_DAYS; step += 1) {
    const window = windowOf(day);

    if (window) {
      const from = Math.max(start, window.start);

      if (from < window.end) {
        const available = window.end - from;

        if (remaining <= available) {
          return from + remaining;
        }

        remaining -= available;
      }
    }

    day = addDays(day, 1);
  }

  throw new NoBusinessTimeError();
}

/**
 * Going back, the earliest instant with the amount still ahead: when the amount ends exactly at
 * the start of a window, the answer is the end of the previous business window, because the
 * business time ahead does not change outside the windows.
 */
function subtractBusiness(end: number, amount: number, calendar: BusinessCalendar): number {
  const windowOf = windowsOf(calendar);
  let day = zonedDayOf(new Date(end), calendar.timeZone);
  let remaining = amount;

  for (let step = 0; step < MAX_SEARCH_DAYS; step += 1) {
    const window = windowOf(day);

    if (window) {
      const to = Math.min(end, window.end);

      if (to > window.start) {
        if (remaining === 0) {
          return to;
        }

        const available = to - window.start;

        if (remaining < available) {
          return to - remaining;
        }

        remaining -= available;
      }
    }

    day = addDays(day, -1);
  }

  throw new NoBusinessTimeError();
}

/** The instant `amount` ms of clock time after (positive) or before (negative) `start`. */
export function addClockTime(start: Date, amount: number, clock: SlaClock): Date {
  if (clock.kind === "calendar" || amount === 0) {
    return new Date(start.getTime() + amount);
  }

  return new Date(
    amount > 0
      ? addBusiness(start.getTime(), amount, clock.calendar)
      : subtractBusiness(start.getTime(), -amount, clock.calendar),
  );
}

/** Clock time from `from` to `to` in ms; negative when `to` comes first. */
export function clockTimeBetween(from: Date, to: Date, clock: SlaClock): number {
  if (clock.kind === "calendar") {
    return to.getTime() - from.getTime();
  }

  if (to.getTime() < from.getTime()) {
    return -clockTimeBetween(to, from, clock);
  }

  const windowOf = windowsOf(clock.calendar);
  const first = zonedDayOf(from, clock.calendar.timeZone);
  const last = zonedDayOf(to, clock.calendar.timeZone);
  let total = 0;
  let day = first;

  for (let step = 0; step <= MAX_SEARCH_DAYS; step += 1) {
    const window = windowOf(day);

    if (window) {
      const overlap = Math.min(to.getTime(), window.end) - Math.max(from.getTime(), window.start);
      total += Math.max(0, overlap);
    }

    if (day === last) {
      return total;
    }

    day = addDays(day, 1);
  }

  throw new NoBusinessTimeError();
}
