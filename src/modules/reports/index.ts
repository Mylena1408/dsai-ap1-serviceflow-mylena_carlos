import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as analytics from "./application/analytics";
import * as dashboard from "./application/dashboard";
import type { Dashboard, DashboardCsv } from "./application/dashboard";
import { createPrismaAnalyticsReader } from "./infrastructure/prisma-analytics-reader";
import { createPrismaDashboardReader } from "./infrastructure/prisma-dashboard-reader";

// Dashboard, indicators and CSV export (SPEC 2026-11-02-painel-relatorios).
export {
  DEFAULT_REPORT_PERIOD,
  MAX_REPORT_PERIOD_DAYS,
  REPORT_PERIOD_OPTIONS,
  REPORT_TIME_ZONE,
  lastDaysPeriod,
  parseReportPeriod,
} from "./domain/period";
export type { ReportPeriod, ReportPeriodError, ReportPeriodOption, ReportPeriodResult } from "./domain/period";
export {
  barPercentage,
  completionTimes,
  completionTimesFromAggregate,
  onTimePercentage,
  sortReportGroups,
} from "./domain/metrics";
export type { CompletionTimes, ReportGroup } from "./domain/metrics";
export {
  REPORT_CSV_COLUMNS,
  REPORT_CSV_MAX_ROWS,
  assertReportCsvSize,
  buildRequestsCsv,
  csvField,
  reportCsvFileName,
} from "./domain/csv";
export type { ReportCsvRow } from "./domain/csv";
export type {
  Dashboard,
  DashboardAudience,
  DashboardCsv,
  DashboardTotals,
  SectorFilterError,
} from "./application/dashboard";
export type { CurrentCounts, DashboardReader, ReportSector } from "./application/ports";

type RawParams = Record<string, string | string[] | undefined>;

/** Dashboard of the signed-in administrator or manager (SPEC 2026-11-02-painel-relatorios, 5.1). */
export async function getDashboard(
  params: RawParams,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<Dashboard> {
  return dashboard.getDashboard(params, createPrismaDashboardReader(database), now);
}

/** CSV of the same scope and period (section 5.4). */
export async function exportDashboardCsv(
  params: RawParams,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<DashboardCsv> {
  return dashboard.exportDashboardCsv(params, createPrismaDashboardReader(database), now);
}

// Operational analytics (SPEC 2026-11-06-analises-operacionais).
export {
  FEW_DATA_THRESHOLD,
  WEEKDAY_LABELS,
  analyticsGranularity,
  analyticsIntervals,
  arrivalGrid,
  intensityStep,
  timeLoggedSummary,
} from "./domain/analytics";
export type {
  AnalyticsGranularity,
  AnalyticsInterval,
  ArrivalGrid,
  OnTimeGroup,
  SatisfactionSummary,
  StageTime,
  TeamMember,
  TimeLoggedGroup,
  TimeLoggedSummary,
  TrendPoint,
} from "./domain/analytics";
export { PRIORITY_ORDER } from "./application/analytics";
export type { Analytics, AttendantDashboard, WorkSummary } from "./application/analytics";
export type { AnalyticsReader } from "./application/analytics-ports";

/** "Meu painel" of the signed-in attendant (section 5.3). */
export async function getAttendantDashboard(
  params: RawParams,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<analytics.AttendantDashboard> {
  return analytics.getAttendantDashboard(params, createPrismaAnalyticsReader(database), now);
}

/** "Análises" of the signed-in administrator or manager (sections 5.4 to 5.6). */
export async function getAnalytics(
  params: RawParams,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<analytics.Analytics> {
  return analytics.getAnalytics(params, createPrismaAnalyticsReader(database), now);
}

/**
 * The scope of the sector's reports (SPEC 2026-11-02-painel-relatorios, 5.1), for other reports with the same rules,
 * such as the time report (SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 item 4).
 */
export function resolveReportScope(params: RawParams, database: PrismaClient = prisma) {
  return dashboard.resolveScope(params, createPrismaDashboardReader(database));
}
