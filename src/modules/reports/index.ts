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
export { barPercentage, completionTimes, onTimePercentage, sortReportGroups } from "./domain/metrics";
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
