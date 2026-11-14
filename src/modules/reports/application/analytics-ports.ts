import type { PriorityValue } from "@/shared/requests";
import type {
  ChecklistCompletionRows,
  DailyCounts,
  DurationAggregate,
  SatisfactionRows,
  StageTimeRow,
  TeamMemberRow,
  TimeLoggedRow,
} from "../domain/analytics";
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
  /**
   * SPEC 2026-11-06-escalonamento, 2.4: requests escalated in the range by the sector's option
   * (the rules are counted apart, SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 5).
   */
  escalations(scope: DashboardScope, range: DashboardRange): Promise<number>;
  /** 7.3 item 5: requests escalated by a rule in the range, per trigger. Optional for older doubles. */
  ruleEscalations?(scope: DashboardScope, range: DashboardRange): Promise<RuleEscalationCounts>;
  /**
   * SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8: requests the system distributed in the range
   * (entering the queue or handed over on an absence). Optional for older doubles.
   */
  automaticAssignments?(scope: DashboardScope, range: DashboardRange): Promise<number>;
  /**
   * SPEC 2026-11-08-atendimento-dia-a-dia, 3.1 item 4: requests opened in the range that have each tag now,
   * with the tag's sector. Optional for older doubles.
   */
  requestsByTag?(scope: DashboardScope, range: DashboardRange): Promise<Array<{ name: string; sectorName: string; count: number }>>;
  /**
   * SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3: minutes and entries not removed whose day is in the period, per
   * current sector and service of the request. Optional for older doubles: absent = no hours.
   */
  timeLogged?(scope: DashboardScope, days: { firstDay: string; lastDay: string }): Promise<TimeLoggedRow[]>;
  /**
   * 9.1 item 3: the requests completed in the range that have checklist items, how many have every item marked,
   * and the optional items left unmarked on them. Optional for older doubles: absent = no checklist.
   */
  checklistCompletion?(scope: DashboardScope, range: DashboardRange): Promise<ChecklistCompletionRows>;
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6: approval levels whose deadline fell in
   * the range and that were decided after it or are still pending past it. Optional for older doubles.
   */
  overdueApprovals?(scope: DashboardScope, range: DashboardRange, now: Date): Promise<number>;
}

/** Requests escalated by a rule, per trigger (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 5). */
export interface RuleEscalationCounts {
  dueSoon: number;
  overdueDays: number;
}
