// Calculations of the dashboard indicators (SPEC 2026-11-02-painel-relatorios, 5.3).

const HOUR_MS = 60 * 60 * 1000;

export interface CompletionTimes {
  /** Hours from opening to completion, with one decimal place. */
  averageHours: number;
  medianHours: number;
}

export interface ReportGroup {
  label: string;
  count: number;
}

function hours(milliseconds: number): number {
  return Math.round((milliseconds / HOUR_MS) * 10) / 10;
}

/** Average and median time to completion; null without completed requests ("—" on screen). */
export function completionTimes(durationsMs: readonly number[]): CompletionTimes | null {
  if (durationsMs.length === 0) {
    return null;
  }

  const sorted = [...durationsMs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const average = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  return { averageHours: hours(average), medianHours: hours(median) };
}

/**
 * Whole percentage of the completed requests with a due date that finished on time; null when
 * none had a due date ("sem prazo definido" on screen).
 */
export function onTimePercentage(onTime: number, withDueDate: number): number | null {
  return withDueDate === 0 ? null : Math.round((onTime / withDueDate) * 100);
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Largest group first; ties by name (section 5.3). */
export function sortReportGroups(groups: readonly ReportGroup[]): ReportGroup[] {
  return [...groups].sort((left, right) => right.count - left.count || collator.compare(left.label, right.label));
}

/** Width of a bar relative to the largest group, from 0 to 100 (section 5.5). */
export function barPercentage(count: number, largest: number): number {
  return largest <= 0 ? 0 : Math.round((count / largest) * 100);
}
