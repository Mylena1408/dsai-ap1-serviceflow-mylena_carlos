import type { StatusValue } from "@/shared/requests";
import type { ReportCsvRow } from "../domain/csv";
import type { ReportGroup } from "../domain/metrics";

// Reading port of the dashboard (SPEC 2026-11-02-painel-relatorios, 5.6): aggregates computed by
// the database on every visit, from the existing tables.

/** Requests counted: every sector (administrator without a filter) or one sector. */
export interface DashboardScope {
  sectorId: string | null;
}

export interface DashboardRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  before: Date;
}

export interface ReportSector {
  id: string;
  name: string;
  isActive: boolean;
}

/** Current situation (section 5.3), independent of the period. */
export interface CurrentCounts {
  open: number;
  awaitingApproval: number;
  inProgress: number;
  dueSoon: number;
  overdue: number;
}

export interface StatusGroup {
  status: StatusValue;
  count: number;
}

/** Indicators of the period (section 5.3), before formatting. */
export interface PeriodTotals {
  opened: number;
  completed: number;
  cancelled: number;
  /** Time from opening to completion of the requests completed in the period; null without any. */
  completion: { averageMs: number; medianMs: number } | null;
  /** Completed in the period with a due date, and those finished on time. */
  withDueDate: number;
  onTime: number;
  /** Requests opened in the period, by the names recorded at opening and by current status. */
  byCategory: ReportGroup[];
  bySector: ReportGroup[];
  byStatus: StatusGroup[];
}

/** A request of the export, with what the SLA situation needs (computed at export time). */
export type ExportRequestRow = Omit<ReportCsvRow, "slaSituation"> & {
  slaHoursSnapshot: number | null;
  /** SPEC 2026-11-03-pausa-sla-calendario: present only in business hours or while paused. */
  slaBusinessHours?: true;
  dueSoonAt?: Date | null;
  slaPausedAt?: Date;
};

export interface DashboardReader {
  findSector(sectorId: string): Promise<ReportSector | null>;
  /** Every sector, by name, for the administrator's filter. */
  listSectors(): Promise<ReportSector[]>;
  currentCounts(scope: DashboardScope, now: Date): Promise<CurrentCounts>;
  periodTotals(scope: DashboardScope, range: DashboardRange): Promise<PeriodTotals>;
  /** Requests opened in the range, oldest first, at most `limit`. */
  listForExport(scope: DashboardScope, range: DashboardRange, limit: number): Promise<ExportRequestRow[]>;
}
