import {
  SAO_PAULO_TIME_ZONE,
  addDays,
  calendarDayError,
  daysBetweenInclusive,
  startOfZonedDay,
  zonedDayOf,
} from "@/shared/time";

// Period of the dashboard (SPEC 2026-11-02-painel-relatorios, 5.2) and of the audit section
// (SPEC 2026-11-02-auditoria-lgpd, 5.2): the last 7, 30 or 90 days, or a range of days, counted
// in São Paulo. The criteria come from the URL.

export const REPORT_TIME_ZONE = SAO_PAULO_TIME_ZONE;
export const REPORT_PERIOD_OPTIONS = ["7", "30", "90", "custom"] as const;
export const DEFAULT_REPORT_PERIOD = "30";
export const MAX_REPORT_PERIOD_DAYS = 366;

export type ReportPeriodOption = (typeof REPORT_PERIOD_OPTIONS)[number];

export type ReportPeriodError =
  | "invalid_option"
  | "missing_dates"
  | "invalid_date"
  | "inverted_range"
  | "future_date"
  | "too_long";

export interface ReportPeriod {
  option: ReportPeriodOption;
  /** First and last calendar days, both included (YYYY-MM-DD in São Paulo). */
  firstDay: string;
  lastDay: string;
  /** Inclusive lower bound: midnight of the first day in São Paulo. */
  from: Date;
  /** Exclusive upper bound: midnight of the day after the last day in São Paulo. */
  before: Date;
}

/** The period to show and, when the request was refused, why (the default period is shown). */
export interface ReportPeriodResult {
  period: ReportPeriod;
  error: ReportPeriodError | null;
}

type RawValue = string | string[] | undefined;

function single(value: RawValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function periodOf(option: ReportPeriodOption, firstDay: string, lastDay: string): ReportPeriod {
  return {
    option,
    firstDay,
    lastDay,
    from: startOfZonedDay(firstDay, REPORT_TIME_ZONE),
    before: startOfZonedDay(addDays(lastDay, 1), REPORT_TIME_ZONE),
  };
}

/** The last `days` days, today included. */
export function lastDaysPeriod(days: 7 | 30 | 90, now: Date): ReportPeriod {
  const today = zonedDayOf(now, REPORT_TIME_ZONE);
  return periodOf(String(days) as ReportPeriodOption, addDays(today, 1 - days), today);
}

function customPeriod(fromRaw: string | undefined, toRaw: string | undefined, now: Date): ReportPeriod | ReportPeriodError {
  if (!fromRaw || !toRaw) {
    return "missing_dates";
  }
  if (calendarDayError(fromRaw) || calendarDayError(toRaw)) {
    return "invalid_date";
  }
  if (fromRaw > toRaw) {
    return "inverted_range";
  }
  if (toRaw > zonedDayOf(now, REPORT_TIME_ZONE)) {
    return "future_date";
  }
  if (daysBetweenInclusive(fromRaw, toRaw) > MAX_REPORT_PERIOD_DAYS) {
    return "too_long";
  }
  return periodOf("custom", fromRaw, toRaw);
}

/**
 * Turns `period`, `from` and `to` from the URL into a period. Without `period`, the last 30
 * days; `from` and `to` count only with `period=custom`. Refused values fall back to the
 * default period and report the reason.
 */
export function parseReportPeriod(raw: Record<string, RawValue>, now: Date): ReportPeriodResult {
  const option = single(raw.period) || DEFAULT_REPORT_PERIOD;
  const fallback = lastDaysPeriod(30, now);

  if (!REPORT_PERIOD_OPTIONS.includes(option as ReportPeriodOption)) {
    return { period: fallback, error: "invalid_option" };
  }

  if (option !== "custom") {
    return { period: lastDaysPeriod(Number(option) as 7 | 30 | 90, now), error: null };
  }

  const custom = customPeriod(single(raw.from), single(raw.to), now);
  return typeof custom === "string" ? { period: fallback, error: custom } : { period: custom, error: null };
}
