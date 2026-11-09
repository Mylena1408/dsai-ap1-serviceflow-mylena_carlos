import { ValidationError } from "@/server/errors";
import { requestShortCode } from "@/shared/requests";
import type { ReportPeriod, ReportPeriodError, ReportSector } from "@/modules/reports";

// The time report (SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 3 and 5.3 item 4): the hours logged in the
// period by attendant, by service and by sector, with a CSV. The manager sees their sector (the same rules of the
// sector's reports); the administrator sees every sector or one. Only entries not removed count, by their day.

export const TIME_CSV_COLUMNS = ["Dia", "Atendente", "Setor", "Serviço", "Solicitação", "Minutos", "Horas"] as const;
export const TIME_CSV_MAX_ROWS = 10_000;

export interface TimeReportScope {
  audience: "organization" | "sector";
  sectors: ReportSector[];
  /** Null when there is nothing to read (a manager without an active sector). */
  scope: { sectorId: string | null } | null;
  sector: { id: string; name: string } | null;
  sectorError: "invalid_sector" | null;
}

/** One sum of minutes for an attendant, a service and a sector in the period. */
export interface TimeSumRow {
  userId: string;
  userName: string;
  serviceName: string;
  sectorId: string;
  sectorName: string;
  minutes: number;
  entries: number;
}

/** One entry for the CSV: no description of the request, only its short code (5.3 item 4). */
export interface TimeCsvRow {
  workedOn: string;
  userName: string;
  sectorName: string;
  serviceName: string;
  requestId: string;
  minutes: number;
}

/**
 * 13.2 item 1: for each service, the requests completed in the period that have time, the average logged on them
 * and the service's estimate (none when it has no estimate).
 */
export interface ServiceEstimateRow {
  serviceId: string;
  serviceName: string;
  estimatedHours: number | null;
  completed: number;
  averageMinutes: number;
}

export interface TimeReportReader {
  sums(scope: { sectorId: string | null }, period: { firstDay: string; lastDay: string }): Promise<TimeSumRow[]>;
  entries(scope: { sectorId: string | null }, period: { firstDay: string; lastDay: string }, limit: number): Promise<TimeCsvRow[]>;
  /** Optional for older doubles: absent = no comparison. */
  estimates?(scope: { sectorId: string | null }, period: { from: Date; before: Date }): Promise<ServiceEstimateRow[]>;
}

export interface TimeGroup {
  key: string;
  label: string;
  minutes: number;
  entries: number;
}

export interface TimeReport {
  audience: TimeReportScope["audience"];
  sectors: ReportSector[];
  sector: { id: string; name: string } | null;
  withoutSector: boolean;
  period: ReportPeriod;
  errors: { period: ReportPeriodError | null; sector: "invalid_sector" | null };
  totalMinutes: number;
  byAttendant: TimeGroup[];
  byService: TimeGroup[];
  bySector: TimeGroup[];
  /** 13.2 item 1: the average logged on completed requests against each service's estimate. */
  estimates: ServiceEstimateRow[];
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Groups the sums by a key, most minutes first, then by name. */
export function groupTime(rows: readonly TimeSumRow[], keyOf: (row: TimeSumRow) => string, labelOf: (row: TimeSumRow) => string): TimeGroup[] {
  const groups = new Map<string, TimeGroup>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? { key, label: labelOf(row), minutes: 0, entries: 0 };
    group.minutes += row.minutes;
    group.entries += row.entries;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.minutes - left.minutes || collator.compare(left.label, right.label));
}

export async function buildTimeReport(
  resolved: TimeReportScope,
  periodResult: { period: ReportPeriod; error: ReportPeriodError | null },
  reader: TimeReportReader,
): Promise<TimeReport> {
  const base = {
    audience: resolved.audience,
    sectors: resolved.sectors,
    sector: resolved.sector,
    period: periodResult.period,
    errors: { period: periodResult.error, sector: resolved.sectorError },
  };
  if (!resolved.scope) {
    return { ...base, withoutSector: true, totalMinutes: 0, byAttendant: [], byService: [], bySector: [], estimates: [] };
  }
  const [rows, estimates] = await Promise.all([
    reader.sums(resolved.scope, periodResult.period),
    reader.estimates ? reader.estimates(resolved.scope, periodResult.period) : Promise.resolve([]),
  ]);
  // The administrator over every sector sees each person's sector next to the name.
  const showSector = resolved.audience === "organization" && resolved.sector === null;
  return {
    ...base,
    withoutSector: false,
    totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
    byAttendant: groupTime(
      rows,
      (row) => (showSector ? `${row.userId}:${row.sectorId}` : row.userId),
      (row) => (showSector ? `${row.userName} (${row.sectorName})` : row.userName),
    ),
    byService: groupTime(
      rows,
      (row) => (showSector ? `${row.serviceName}:${row.sectorId}` : row.serviceName),
      (row) => (showSector ? `${row.serviceName} (${row.sectorName})` : row.serviceName),
    ),
    bySector: groupTime(rows, (row) => row.sectorId, (row) => row.sectorName),
    estimates: [...estimates].sort((left, right) => collator.compare(left.serviceName, right.serviceName)),
  };
}

/** 5.3 item 4: the entries of the period; over 10,000 rows, the export is refused (as the dashboard's CSV). */
export async function buildTimeCsvRows(
  resolved: TimeReportScope,
  periodResult: { period: ReportPeriod; error: ReportPeriodError | null },
  reader: TimeReportReader,
): Promise<TimeCsvRow[]> {
  if (periodResult.error) throw new ValidationError([{ path: ["period"], code: "invalid_value" }]);
  if (resolved.sectorError) throw new ValidationError([{ path: ["sector"], code: "invalid_value" }]);
  if (!resolved.scope) return [];
  const rows = await reader.entries(resolved.scope, periodResult.period, TIME_CSV_MAX_ROWS + 1);
  if (rows.length > TIME_CSV_MAX_ROWS) throw new ValidationError([{ path: [], code: "too_big" }]);
  return rows;
}

/** "1,50" for 90 minutes: the hours with two decimals and a decimal comma, as spreadsheets in Portuguese read them. */
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2).replace(".", ",");
}

/** The CSV: the same separator, line ends and byte order mark as the dashboard's export. */
export function buildTimeCsv(rows: readonly TimeCsvRow[], field: (value: string) => string): string {
  const lines = [
    TIME_CSV_COLUMNS.map(field).join(";"),
    ...rows.map((row) =>
      [row.workedOn, row.userName, row.sectorName, row.serviceName, requestShortCode(row.requestId), String(row.minutes), decimalHours(row.minutes)]
        .map(field)
        .join(";"),
    ),
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function timeCsvFileName(period: Pick<ReportPeriod, "firstDay" | "lastDay">): string {
  return `serviceflow-horas-${period.firstDay}-a-${period.lastDay}.csv`;
}
