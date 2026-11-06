import type { PriorityValue } from "@/shared/requests";
import type { DailyCounts, DurationAggregate, SatisfactionRows, StageTimeRow, TeamMemberRow } from "../domain/analytics";
import type { DashboardRange, DashboardScope, ReportSector } from "./ports";

// Reading port of the operational analytics (SPEC 2026-11-06-analises-operacionais, 5.8): every
// number is aggregated by the database on each visit, from the existing tables. No method reads
// a description, a comment text, a document or anything about the requester.

/** The attendant's own sector and identity (5.3). */
export interface AttendantScope {
  sectorId: string;
  attendantId: string;
}

export interface CountByPriority {
  priority: PriorityValue;
  count: number;
}

export interface CountByLabel {
  label: string;
  count: number;
}

/** "Fila agora" (5.3): independent of the period. */
export interface AttendantQueueCounts {
  unassigned: number;
  mine: number;
  dueSoon: number;
  overdue: number;
  paused: number;
  byPriority: CountByPriority[];
  /** In progress, by the name of the current stage; null label means "Sem etapa". */
  byStage: Array<{ label: string | null; count: number }>;
}

/** Completed work in the period (5.3), for the attendant or for the whole sector. */
export interface WorkTotals {
  completed: number;
  completion: DurationAggregate;
  withDueDate: number;
  onTime: number;
  /** Non-internal comments written by attendants (by the attendant, in "mine"). */
  replies: number;
}

export interface OnTimeRow {
  label: string;
  withDueDate: number;
  onTime: number;
}

export interface PauseTotals {
  /** Completed in the period. */
  completed: number;
  /** Total paused time of each completed request that had at least one pause. */
  paused: DurationAggregate;
}

export interface FirstResponseTotals {
  answered: DurationAggregate;
  unanswered: number;
}

export interface AnalyticsReader {
  findSector(sectorId: string): Promise<ReportSector | null>;
  listSectors(): Promise<ReportSector[]>;

  attendantQueue(scope: AttendantScope, now: Date): Promise<AttendantQueueCounts>;
  attendantWork(scope: AttendantScope, range: DashboardRange): Promise<{ mine: WorkTotals; sector: WorkTotals }>;

  /** Opened and completed per São Paulo day of the range. */
  dailyCounts(scope: DashboardScope, range: DashboardRange): Promise<DailyCounts[]>;
  /** For each instant, the requests whose last status before it is open or in progress. */
  pendingAt(scope: DashboardScope, instants: readonly Date[]): Promise<number[]>;
  firstResponse(scope: DashboardScope, range: DashboardRange): Promise<FirstResponseTotals>;
  stageTimes(scope: DashboardScope, range: DashboardRange): Promise<StageTimeRow[]>;
  pauses(scope: DashboardScope, range: DashboardRange): Promise<PauseTotals>;
  onTimeByService(scope: DashboardScope, range: DashboardRange): Promise<OnTimeRow[]>;
  onTimeByPriority(scope: DashboardScope, range: DashboardRange): Promise<Array<{ priority: PriorityValue; withDueDate: number; onTime: number }>>;
  arrivals(scope: DashboardScope, range: DashboardRange): Promise<Array<{ isoWeekday: number; hour: number; count: number }>>;
  team(scope: DashboardScope, range: DashboardRange): Promise<TeamMemberRow[]>;
  /** SPEC 2026-11-06-pesquisa-satisfacao, 4.7: numbers only, never a comment. */
  satisfaction(scope: DashboardScope, range: DashboardRange): Promise<SatisfactionRows>;
  /** SPEC 2026-11-06-escalonamento, 2.4: requests escalated in the range. */
  escalations(scope: DashboardScope, range: DashboardRange): Promise<number>;
}
