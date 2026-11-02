// The period rules are shared with the audit section (SPEC 2026-11-02-auditoria-lgpd, 5.2).
export {
  DEFAULT_REPORT_PERIOD,
  MAX_REPORT_PERIOD_DAYS,
  REPORT_PERIOD_OPTIONS,
  REPORT_TIME_ZONE,
  lastDaysPeriod,
  parseReportPeriod,
} from "@/shared/periods";
export type { ReportPeriod, ReportPeriodError, ReportPeriodOption, ReportPeriodResult } from "@/shared/periods";
