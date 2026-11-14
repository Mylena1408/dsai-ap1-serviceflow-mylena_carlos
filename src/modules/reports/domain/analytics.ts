import { addDays, daysBetweenInclusive, isoWeekdayOf, startOfZonedDay } from "@/shared/time";
import type { ReportPeriod } from "@/shared/periods";
import { completionTimesFromAggregate, onTimePercentage, type CompletionTimes } from "./metrics";

// Pure rules of the operational analytics (SPEC 2026-11-06-analises-operacionais, 5.2 to 5.6):
// intervals of the series, folding of daily counts, percentages with "few data", the weekday ×
// hour grid and the order of the team table. Every day is a São Paulo calendar day.

export const MAX_DAILY_INTERVAL_DAYS = 31;
/** Below this many completed requests with a due date, a group is marked "poucos dados" (5.5.4). */
export const FEW_DATA_THRESHOLD = 3;

export type AnalyticsGranularity = "day" | "week";

export interface AnalyticsInterval {
  /** First and last São Paulo days of the interval, both included (YYYY-MM-DD). */
  firstDay: string;
  lastDay: string;
  /** Inclusive start and exclusive end instants. */
  start: Date;
  end: Date;
  /** "06/11" for a day, "03/11–09/11" for a week. */
  label: string;
}

/** Days up to 31 days, Monday-to-Sunday weeks above (5.2, decision A4). */
export function analyticsGranularity(period: Pick<ReportPeriod, "firstDay" | "lastDay">): AnalyticsGranularity {
  return daysBetweenInclusive(period.firstDay, period.lastDay) <= MAX_DAILY_INTERVAL_DAYS ? "day" : "week";
}

function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

function interval(firstDay: string, lastDay: string): AnalyticsInterval {
  return {
    firstDay,
    lastDay,
    start: startOfZonedDay(firstDay),
    end: startOfZonedDay(addDays(lastDay, 1)),
    label: firstDay === lastDay ? shortDay(firstDay) : `${shortDay(firstDay)}–${shortDay(lastDay)}`,
  };
}

/** The intervals of a period; the first and last weeks may be partial. */
export function analyticsIntervals(period: Pick<ReportPeriod, "firstDay" | "lastDay">): AnalyticsInterval[] {
  const intervals: AnalyticsInterval[] = [];
  const weekly = analyticsGranularity(period) === "week";
  let first = period.firstDay;

  while (first <= period.lastDay) {
    // A week ends on Sunday (ISO weekday 7) or at the end of the period.
    const last = weekly ? addDays(first, 7 - isoWeekdayOf(first)) : first;
    const bounded = last > period.lastDay ? period.lastDay : last;
    intervals.push(interval(first, bounded));
    first = addDays(bounded, 1);
  }

  return intervals;
}

/** Index of the interval that contains a São Paulo day, or -1. */
export function intervalIndexOfDay(intervals: readonly AnalyticsInterval[], day: string): number {
  return intervals.findIndex((item) => item.firstDay <= day && day <= item.lastDay);
}

/** Counts of one São Paulo day, as the database returns them. */
export interface DailyCounts {
  day: string;
  opened: number;
  completed: number;
  /** Completed that day with a due date, and those on time. */
  withDueDate: number;
  onTime: number;
}

export interface TrendPoint {
  label: string;
  firstDay: string;
  lastDay: string;
  opened: number;
  completed: number;
  /** Requests whose last status at the end of the interval is open or in progress. */
  pendingAtEnd: number;
  withDueDate: number;
  /** Null when nothing completed in the interval had a due date: the line skips the point. */
  onTimePercentage: number | null;
}

/**
 * Folds daily counts into the intervals and attaches the pending count at the end of each
 * interval (5.4). Days outside the period are ignored.
 */
export function trendSeries(
  intervals: readonly AnalyticsInterval[],
  daily: readonly DailyCounts[],
  pendingAtEnd: readonly number[],
): TrendPoint[] {
  const points = intervals.map((item, index) => ({
    label: item.label,
    firstDay: item.firstDay,
    lastDay: item.lastDay,
    opened: 0,
    completed: 0,
    pendingAtEnd: pendingAtEnd[index] ?? 0,
    withDueDate: 0,
    onTime: 0,
  }));

  for (const counts of daily) {
    const point = points[intervalIndexOfDay(intervals, counts.day)];
    if (!point) continue;
    point.opened += counts.opened;
    point.completed += counts.completed;
    point.withDueDate += counts.withDueDate;
    point.onTime += counts.onTime;
  }

  return points.map(({ onTime, ...point }) => ({ ...point, onTimePercentage: onTimePercentage(onTime, point.withDueDate) }));
}

/** On-time share of a group of completed requests with a due date (5.5.4). */
export interface OnTimeGroup {
  label: string;
  withDueDate: number;
  onTime: number;
  percentage: number | null;
  fewData: boolean;
}

/**
 * Groups with at least one completed request with a due date. "volume" orders by that count
 * (then by name); "given" keeps the input order, e.g. priorities from the most urgent.
 */
export function onTimeGroups(
  rows: ReadonlyArray<{ label: string; withDueDate: number; onTime: number }>,
  order: "volume" | "given" = "volume",
): OnTimeGroup[] {
  const groups = rows
    .filter((row) => row.withDueDate > 0)
    .map((row) => ({
      label: row.label,
      withDueDate: row.withDueDate,
      onTime: row.onTime,
      percentage: onTimePercentage(row.onTime, row.withDueDate),
      fewData: row.withDueDate < FEW_DATA_THRESHOLD,
    }));
  return order === "given"
    ? groups
    : groups.sort((left, right) => right.withDueDate - left.withDueDate || collator.compare(left.label, right.label));
}

/** Average and median of a group, from the database aggregate (milliseconds). */
export interface DurationAggregate {
  count: number;
  averageMs: number | null;
  medianMs: number | null;
}

export function durationTimes(aggregate: DurationAggregate): CompletionTimes | null {
  return aggregate.count === 0 || aggregate.averageMs === null || aggregate.medianMs === null
    ? null
    : completionTimesFromAggregate({ averageMs: aggregate.averageMs, medianMs: aggregate.medianMs });
}

export const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

export interface ArrivalGrid {
  /** 7 rows (Monday to Sunday) of 24 hours each. */
  cells: number[][];
  largest: number;
  total: number;
}

/** Weekday × hour grid of the opened requests (5.5.5); ISO weekday 1 is Monday. */
export function arrivalGrid(rows: ReadonlyArray<{ isoWeekday: number; hour: number; count: number }>): ArrivalGrid {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const row of rows) {
    if (row.isoWeekday < 1 || row.isoWeekday > 7 || row.hour < 0 || row.hour > 23) continue;
    cells[row.isoWeekday - 1][row.hour] += row.count;
  }
  const flat = cells.flat();
  return { cells, largest: Math.max(0, ...flat), total: flat.reduce((sum, value) => sum + value, 0) };
}

/**
 * Intensity step of a grid cell, 0 (empty) to 5, for a single-hue sequential scale (5.7). A
 * non-empty cell is at least step 1, so it never looks empty.
 */
export function intensityStep(count: number, largest: number, steps = 5): number {
  if (count <= 0 || largest <= 0) return 0;
  return Math.max(1, Math.ceil((count / largest) * steps));
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** One person of the team table (5.6), before formatting. */
export interface TeamMemberRow {
  userId: string;
  name: string;
  isActive: boolean;
  sectorName: string | null;
  completed: number;
  completion: DurationAggregate;
  withDueDate: number;
  onTime: number;
  pendingNow: number;
}

export interface TeamMember {
  userId: string;
  name: string;
  isActive: boolean;
  sectorName: string | null;
  completed: number;
  completion: CompletionTimes | null;
  onTimePercentage: number | null;
  pendingNow: number;
}

/** Alphabetical order, never a ranking (decision A7); people with nothing to show are left out. */
export function teamTable(rows: readonly TeamMemberRow[]): TeamMember[] {
  return rows
    .filter((row) => row.completed > 0 || row.pendingNow > 0)
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      isActive: row.isActive,
      sectorName: row.sectorName,
      completed: row.completed,
      completion: durationTimes(row.completion),
      onTimePercentage: onTimePercentage(row.onTime, row.withDueDate),
      pendingNow: row.pendingNow,
    }))
    .sort((left, right) => collator.compare(left.name, right.name) || left.userId.localeCompare(right.userId));
}

/** Stage time of one "service · stage" group (5.5.2). */
export interface StageTimeRow {
  serviceName: string;
  stageName: string;
  /** Position of the stage in the flow, for the order within a service. */
  stageOrder: number;
  duration: DurationAggregate;
}

export interface StageTime {
  serviceName: string;
  stageName: string;
  count: number;
  times: CompletionTimes | null;
}

export function stageTimes(rows: readonly StageTimeRow[]): StageTime[] {
  return [...rows]
    .sort((left, right) => collator.compare(left.serviceName, right.serviceName) || left.stageOrder - right.stageOrder)
    .map((row) => ({ serviceName: row.serviceName, stageName: row.stageName, count: row.duration.count, times: durationTimes(row.duration) }));
}

/** Ratings of the period as the database returns them (SPEC 2026-11-06-pesquisa-satisfacao, 4.7). */
export interface SatisfactionRows {
  /** Count per rating 1 to 5 of the ratings given in the period. */
  distribution: ReadonlyArray<{ rating: number; count: number }>;
  /** Requests completed in the period, and how many of them have a rating of that completion. */
  completed: number;
  ratedCompletions: number;
  byService: ReadonlyArray<{ label: string; count: number; sum: number }>;
}

export interface SatisfactionSummary {
  count: number;
  /** One decimal place; null without ratings. */
  average: number | null;
  /** Ratings 5 down to 1, every one present. */
  distribution: Array<{ rating: number; count: number }>;
  /** Whole percentage of the completed requests of the period that were rated; null without any. */
  responseRate: number | null;
  byService: Array<{ label: string; count: number; average: number; fewData: boolean }>;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function satisfactionSummary(rows: SatisfactionRows): SatisfactionSummary {
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: rows.distribution.filter((row) => row.rating === rating).reduce((sum, row) => sum + row.count, 0),
  }));
  const count = distribution.reduce((sum, row) => sum + row.count, 0);
  const total = distribution.reduce((sum, row) => sum + row.rating * row.count, 0);
  return {
    count,
    average: count === 0 ? null : oneDecimal(total / count),
    distribution,
    responseRate: rows.completed === 0 ? null : Math.round((rows.ratedCompletions / rows.completed) * 100),
    byService: rows.byService
      .filter((row) => row.count > 0)
      .map((row) => ({ label: row.label, count: row.count, average: oneDecimal(row.sum / row.count), fewData: row.count < FEW_DATA_THRESHOLD }))
      .sort((left, right) => right.count - left.count || collator.compare(left.label, right.label)),
  };
}

/**
 * The time logged in the period, per sector and service (SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3): the
 * entries not removed whose day is in the period, on the requests' current sector, as the time report counts them.
 */
export interface TimeLoggedRow {
  sectorId: string;
  sectorName: string;
  serviceName: string;
  minutes: number;
  entries: number;
}

/** A line of the hours: the same shape as the time report's groups. */
export interface TimeLoggedGroup {
  key: string;
  label: string;
  minutes: number;
  entries: number;
}

export interface TimeLoggedSummary {
  totalMinutes: number;
  totalEntries: number;
  /** Only when every sector is shown: with one sector it would repeat the total. */
  bySector: TimeLoggedGroup[];
  byService: TimeLoggedGroup[];
}

function timeGroups(rows: readonly TimeLoggedRow[], keyOf: (row: TimeLoggedRow) => string, labelOf: (row: TimeLoggedRow) => string): TimeLoggedGroup[] {
  const groups = new Map<string, TimeLoggedGroup>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { key, label: labelOf(row), minutes: 0, entries: 0 };
    group.minutes += row.minutes;
    group.entries += row.entries;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes || collator.compare(left.label, right.label));
}

/** Most hours first, then by name; services take the sector's name when every sector is shown. */
export function timeLoggedSummary(rows: readonly TimeLoggedRow[], showSector: boolean): TimeLoggedSummary {
  return {
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    totalEntries: rows.reduce((sum, row) => sum + row.entries, 0),
    bySector: showSector ? timeGroups(rows, (row) => row.sectorId, (row) => row.sectorName) : [],
    byService: timeGroups(
      rows,
      (row) => (showSector ? `${row.sectorId}:${row.serviceName}` : row.serviceName),
      (row) => (showSector ? `${row.serviceName} (${row.sectorName})` : row.serviceName),
    ),
  };
}

/** At most this many optional items in the table of the most skipped (SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3). */
export const MAX_SKIPPED_CHECKLIST_ITEMS = 10;

/**
 * The checklists of the requests completed in the period (9.1 item 3): only the requests that have at least one
 * item count; "complete" is every item marked. The optional items left unmarked, per service and text.
 */
export interface ChecklistCompletionRows {
  withChecklist: number;
  complete: number;
  skipped: ReadonlyArray<{ sectorId: string; sectorName: string; serviceName: string; text: string; count: number }>;
}

export interface ChecklistCompletionSummary {
  withChecklist: number;
  complete: number;
  /** Null without requests with a checklist. */
  completePercentage: number | null;
  /** Most skipped first, then by name; at most MAX_SKIPPED_CHECKLIST_ITEMS. */
  skippedOptional: Array<{ key: string; label: string; count: number }>;
}

export function checklistCompletionSummary(rows: ChecklistCompletionRows, showSector: boolean): ChecklistCompletionSummary {
  return {
    withChecklist: rows.withChecklist,
    complete: rows.complete,
    completePercentage: rows.withChecklist === 0 ? null : Math.round((rows.complete / rows.withChecklist) * 100),
    skippedOptional: rows.skipped
      .filter((row) => row.count > 0)
      .map((row) => ({
        key: `${row.sectorId}:${row.serviceName}:${row.text}`,
        label: `${row.text} · ${row.serviceName}${showSector ? ` (${row.sectorName})` : ""}`,
        count: row.count,
      }))
      .sort((left, right) => right.count - left.count || collator.compare(left.label, right.label))
      .slice(0, MAX_SKIPPED_CHECKLIST_ITEMS),
  };
}
