import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as dashboard from "./application/dashboard";
import type { Dashboard, DashboardCsv } from "./application/dashboard";
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
