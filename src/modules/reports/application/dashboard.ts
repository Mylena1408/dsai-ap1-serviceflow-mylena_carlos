import { slaSituation } from "@/modules/requests";
import { requireCurrentActor } from "@/server/authorization";
import { AuthorizationError, ValidationError } from "@/server/errors";
import { REQUEST_STATUS_LABELS } from "@/shared/requests";
import { REPORT_CSV_MAX_ROWS, assertReportCsvSize, buildRequestsCsv, reportCsvFileName } from "../domain/csv";
import {
  completionTimesFromAggregate,
  onTimePercentage,
  sortReportGroups,
  type CompletionTimes,
  type ReportGroup,
} from "../domain/metrics";
import { parseReportPeriod, type ReportPeriod, type ReportPeriodError } from "../domain/period";
import type { CurrentCounts, DashboardReader, DashboardScope, PeriodTotals, ReportSector } from "./ports";

// Dashboard and CSV export (SPEC 2026-11-02-painel-relatorios, 5.1 and 5.7, decision R1): the
// administrator reads every sector, optionally one; a manager reads only the current sector.
// The scope always comes from the session; the administrator's sector filter is checked here.

type RawParams = Record<string, string | string[] | undefined>;

export type DashboardAudience = "organization" | "sector";
export type SectorFilterError = "invalid_sector";

export interface DashboardTotals {
  opened: number;
  completed: number;
  cancelled: number;
  completion: CompletionTimes | null;
  /** Null when no request completed in the period had a due date. */
  onTimePercentage: number | null;
  byCategory: ReportGroup[];
  /** Only for the administrator without a sector filter. */
  bySector: ReportGroup[] | null;
  byStatus: ReportGroup[];
}

export interface Dashboard {
  audience: DashboardAudience;
  /** Options of the administrator's sector filter; empty for a manager. */
  sectors: ReportSector[];
  /** Sector whose numbers are shown; null for the whole organization. */
  sector: { id: string; name: string } | null;
  /** A manager without an active sector sees an empty dashboard (section 5.1). */
  withoutSector: boolean;
  period: ReportPeriod;
  errors: { period: ReportPeriodError | null; sector: SectorFilterError | null };
  current: CurrentCounts;
  totals: DashboardTotals;
  /** Nothing opened, completed or cancelled in the period ("Nenhuma solicitação no período"). */
  empty: boolean;
}

export interface DashboardCsv {
  fileName: string;
  content: string;
}

interface ResolvedScope {
  audience: DashboardAudience;
  sectors: ReportSector[];
  /** Null when there is nothing the actor may read (manager without an active sector). */
  scope: DashboardScope | null;
  sector: { id: string; name: string } | null;
  sectorError: SectorFilterError | null;
}

const NO_CURRENT: CurrentCounts = { open: 0, awaitingApproval: 0, inProgress: 0, dueSoon: 0, overdue: 0, paused: 0 };
const NO_TOTALS: PeriodTotals = {
  opened: 0,
  completed: 0,
  cancelled: 0,
  completion: null,
  withDueDate: 0,
  onTime: 0,
  byCategory: [],
  bySector: [],
  byStatus: [],
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveScope(raw: RawParams, reader: DashboardReader): Promise<ResolvedScope> {
  const actor = await requireCurrentActor();

  if (actor.role === "ADMIN") {
    const sectors = await reader.listSectors();
    const requested = single(raw.sector) || null;
    const chosen = requested === null ? null : sectors.find((sector) => sector.id === requested);

    if (requested !== null && !chosen) {
      return { audience: "organization", sectors, scope: { sectorId: null }, sector: null, sectorError: "invalid_sector" };
    }

    return {
      audience: "organization",
      sectors,
      scope: { sectorId: chosen?.id ?? null },
      sector: chosen ? { id: chosen.id, name: chosen.name } : null,
      sectorError: null,
    };
  }

  if (actor.role === "MANAGER") {
    const sector = actor.sectorId ? await reader.findSector(actor.sectorId) : null;

    if (!sector?.isActive) {
      return { audience: "sector", sectors: [], scope: null, sector: null, sectorError: null };
    }

    return {
      audience: "sector",
      sectors: [],
      scope: { sectorId: sector.id },
      sector: { id: sector.id, name: sector.name },
      sectorError: null,
    };
  }

  throw new AuthorizationError();
}

function dashboardTotals(totals: PeriodTotals, showSectors: boolean): DashboardTotals {
  return {
    opened: totals.opened,
    completed: totals.completed,
    cancelled: totals.cancelled,
    completion: completionTimesFromAggregate(totals.completion),
    onTimePercentage: onTimePercentage(totals.onTime, totals.withDueDate),
    byCategory: sortReportGroups(totals.byCategory),
    bySector: showSectors ? sortReportGroups(totals.bySector) : null,
    byStatus: sortReportGroups(
      totals.byStatus.map((group) => ({ label: REQUEST_STATUS_LABELS[group.status], count: group.count })),
    ),
  };
}

/** The dashboard for the URL parameters `period`, `from`, `to` and (administrator) `sector`. */
export async function getDashboard(raw: RawParams, reader: DashboardReader, now: Date): Promise<Dashboard> {
  const resolved = await resolveScope(raw, reader);
  const { period, error } = parseReportPeriod(raw, now);
  const range = { from: period.from, before: period.before };
  const [current, totals] = resolved.scope
    ? await Promise.all([reader.currentCounts(resolved.scope, now), reader.periodTotals(resolved.scope, range)])
    : [NO_CURRENT, NO_TOTALS];
  const showSectors = resolved.audience === "organization" && resolved.sector === null;

  return {
    audience: resolved.audience,
    sectors: resolved.sectors,
    sector: resolved.sector,
    withoutSector: resolved.scope === null,
    period,
    errors: { period: error, sector: resolved.sectorError },
    current,
    totals: dashboardTotals(totals, showSectors),
    empty: totals.opened === 0 && totals.completed === 0 && totals.cancelled === 0,
  };
}

/**
 * CSV of the requests opened in the period, same scope as the dashboard (section 5.4). Unlike
 * the screen, a refused period or sector is an error: the file never silently uses the default.
 */
export async function exportDashboardCsv(raw: RawParams, reader: DashboardReader, now: Date): Promise<DashboardCsv> {
  const resolved = await resolveScope(raw, reader);
  const { period, error } = parseReportPeriod(raw, now);

  // Public codes only: "too_big" is kept for the row limit (assertReportCsvSize).
  if (error) {
    throw new ValidationError([{ path: ["period"], code: "invalid_value" }]);
  }
  if (resolved.sectorError) {
    throw new ValidationError([{ path: ["sector"], code: "invalid_value" }]);
  }

  const rows = resolved.scope
    ? await reader.listForExport(resolved.scope, { from: period.from, before: period.before }, REPORT_CSV_MAX_ROWS + 1)
    : [];
  assertReportCsvSize(rows.length);

  return {
    fileName: reportCsvFileName(period),
    content: buildRequestsCsv(
      rows.map(({ slaHoursSnapshot, slaBusinessHours, dueSoonAt, slaPausedAt, ...row }) => ({
        ...row,
        slaSituation: slaSituation({ ...row, slaHoursSnapshot, slaBusinessHours, dueSoonAt, slaPausedAt }, now),
      })),
    ),
  };
}
