import { requireCurrentActor } from "@/server/authorization";
import { AuthorizationError } from "@/server/errors";
import { PRIORITY_LABELS, type PriorityValue } from "@/shared/requests";
import {
  analyticsGranularity,
  analyticsIntervals,
  arrivalGrid,
  durationTimes,
  onTimeGroups,
  satisfactionSummary,
  stageTimes,
  teamTable,
  trendSeries,
  type AnalyticsGranularity,
  type ArrivalGrid,
  type OnTimeGroup,
  type SatisfactionSummary,
  type StageTime,
  type TeamMember,
  type TrendPoint,
} from "../domain/analytics";
import type { CompletionTimes } from "../domain/metrics";
import { onTimePercentage } from "../domain/metrics";
import { parseReportPeriod, type ReportPeriod, type ReportPeriodError } from "../domain/period";
import type { AnalyticsReader, AttendantQueueCounts, RuleEscalationCounts, WorkTotals } from "./analytics-ports";
import { resolveScope, type DashboardAudience, type SectorFilterError } from "./dashboard";
import type { ReportSector } from "./ports";

// Operational analytics (SPEC 2026-11-06-analises-operacionais). "Meu painel" belongs to the
// attendant and covers the current sector and the attendant's own numbers; "Análises" follows
// the dashboard scope rules (administrator: organization or one sector; manager: own sector).

type RawParams = Record<string, string | string[] | undefined>;

/** Display order of the priorities, most urgent first. */
export const PRIORITY_ORDER: readonly PriorityValue[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

export interface WorkSummary {
  completed: number;
  completion: CompletionTimes | null;
  onTimePercentage: number | null;
  replies: number;
}

export interface AttendantDashboard {
  /** Without an active sector the page shows a notice and reads no request (5.1). */
  withoutSector: boolean;
  sectorName: string | null;
  period: ReportPeriod;
  periodError: ReportPeriodError | null;
  queue: {
    unassigned: number;
    mine: number;
    dueSoon: number;
    overdue: number;
    paused: number;
    byPriority: Array<{ label: string; count: number }>;
    byStage: Array<{ label: string; count: number }>;
  };
  mine: WorkSummary;
  sector: WorkSummary;
}

export interface Analytics {
  audience: DashboardAudience;
  sectors: ReportSector[];
  sector: { id: string; name: string } | null;
  withoutSector: boolean;
  period: ReportPeriod;
  errors: { period: ReportPeriodError | null; sector: SectorFilterError | null };
  granularity: AnalyticsGranularity;
  trend: TrendPoint[];
  sla: {
    firstResponse: { times: CompletionTimes | null; answered: number; unanswered: number };
    stages: StageTime[];
    pauses: { completed: number; withPause: number; times: CompletionTimes | null };
    onTimeByService: OnTimeGroup[];
    onTimeByPriority: OnTimeGroup[];
    arrivals: ArrivalGrid;
    /** SPEC 2026-11-06-escalonamento, 2.4: by the sector's option. */
    escalated: number;
    /** SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 5: by the rules, per trigger. */
    escalatedByRule: RuleEscalationCounts;
    /** SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8: assignments made by the distribution. */
    distributedAutomatically: number;
    /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6. */
    overdueApprovals: number;
  };
  team: TeamMember[];
  /** SPEC 2026-11-06-pesquisa-satisfacao, 4.7. */
  satisfaction: SatisfactionSummary;
  /** The administrator without a sector filter sees each person's sector (5.6). */
  teamShowsSector: boolean;
}

const EMPTY_WORK: WorkTotals = { completed: 0, completion: { count: 0, averageMs: null, medianMs: null }, withDueDate: 0, onTime: 0, replies: 0 };
const EMPTY_QUEUE: AttendantQueueCounts = { unassigned: 0, mine: 0, dueSoon: 0, overdue: 0, paused: 0, byPriority: [], byStage: [] };

function workSummary(totals: WorkTotals): WorkSummary {
  return {
    completed: totals.completed,
    completion: durationTimes(totals.completion),
    onTimePercentage: onTimePercentage(totals.onTime, totals.withDueDate),
    replies: totals.replies,
  };
}

function priorityBars(rows: AttendantQueueCounts["byPriority"]): Array<{ label: string; count: number }> {
  return PRIORITY_ORDER.map((priority) => ({
    label: PRIORITY_LABELS[priority],
    count: rows.find((row) => row.priority === priority)?.count ?? 0,
  }));
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

function stageBars(rows: AttendantQueueCounts["byStage"]): Array<{ label: string; count: number }> {
  return rows
    .map((row) => ({ label: row.label ?? "Sem etapa", count: row.count }))
    .sort((left, right) => right.count - left.count || collator.compare(left.label, right.label));
}

/** "Meu painel" (5.3): only an active attendant, only the current sector. */
export async function getAttendantDashboard(raw: RawParams, reader: AnalyticsReader, now: Date): Promise<AttendantDashboard> {
  const actor = await requireCurrentActor();
  if (actor.role !== "ATTENDANT") throw new AuthorizationError();

  const { period, error } = parseReportPeriod(raw, now);
  const sector = actor.sectorId ? await reader.findSector(actor.sectorId) : null;

  if (!sector?.isActive) {
    return {
      withoutSector: true,
      sectorName: null,
      period,
      periodError: error,
      queue: { ...EMPTY_QUEUE, byPriority: priorityBars([]), byStage: [] },
      mine: workSummary(EMPTY_WORK),
      sector: workSummary(EMPTY_WORK),
    };
  }

  const scope = { sectorId: sector.id, attendantId: actor.id };
  const [queue, work] = await Promise.all([
    reader.attendantQueue(scope, now),
    reader.attendantWork(scope, { from: period.from, before: period.before }),
  ]);

  return {
    withoutSector: false,
    sectorName: sector.name,
    period,
    periodError: error,
    queue: { ...queue, byPriority: priorityBars(queue.byPriority), byStage: stageBars(queue.byStage) },
    mine: workSummary(work.mine),
    sector: workSummary(work.sector),
  };
}

const EMPTY_ANALYTICS_SLA: Analytics["sla"] = {
  firstResponse: { times: null, answered: 0, unanswered: 0 },
  stages: [],
  pauses: { completed: 0, withPause: 0, times: null },
  onTimeByService: [],
  onTimeByPriority: [],
  arrivals: arrivalGrid([]),
  escalated: 0,
  escalatedByRule: { dueSoon: 0, overdueDays: 0 },
  distributedAutomatically: 0,
  overdueApprovals: 0,
};

/** "Análises" (5.4 to 5.6): administrator or manager, with the dashboard scope rules. */
export async function getAnalytics(raw: RawParams, reader: AnalyticsReader, now: Date): Promise<Analytics> {
  const resolved = await resolveScope(raw, reader);
  const { period, error } = parseReportPeriod(raw, now);
  const intervals = analyticsIntervals(period);
  const base = {
    audience: resolved.audience,
    sectors: resolved.sectors,
    sector: resolved.sector,
    period,
    errors: { period: error, sector: resolved.sectorError },
    granularity: analyticsGranularity(period),
    teamShowsSector: resolved.audience === "organization" && resolved.sector === null,
  };

  if (!resolved.scope) {
    return {
      ...base,
      withoutSector: true,
      trend: trendSeries(intervals, [], []),
      sla: EMPTY_ANALYTICS_SLA,
      team: [],
      satisfaction: satisfactionSummary({ distribution: [], completed: 0, ratedCompletions: 0, byService: [] }),
    };
  }

  const scope = resolved.scope;
  const range = { from: period.from, before: period.before };
  // The pending count of an interval that has not ended yet is the count now.
  const ends = intervals.map((item) => (item.end.getTime() > now.getTime() ? now : item.end));
  const [daily, pending, firstResponse, stages, pauses, byService, byPriority, arrivals, team, ratings, escalated, overdueApprovals, escalatedByRule, distributedAutomatically] = await Promise.all([
    reader.dailyCounts(scope, range),
    reader.pendingAt(scope, ends),
    reader.firstResponse(scope, range),
    reader.stageTimes(scope, range),
    reader.pauses(scope, range),
    reader.onTimeByService(scope, range),
    reader.onTimeByPriority(scope, range),
    reader.arrivals(scope, range),
    reader.team(scope, range),
    reader.satisfaction(scope, range),
    reader.escalations(scope, range),
    reader.overdueApprovals ? reader.overdueApprovals(scope, range, now) : Promise.resolve(0),
    reader.ruleEscalations ? reader.ruleEscalations(scope, range) : Promise.resolve({ dueSoon: 0, overdueDays: 0 }),
    reader.automaticAssignments ? reader.automaticAssignments(scope, range) : Promise.resolve(0),
  ]);

  return {
    ...base,
    withoutSector: false,
    trend: trendSeries(intervals, daily, pending),
    sla: {
      firstResponse: {
        times: durationTimes(firstResponse.answered),
        answered: firstResponse.answered.count,
        unanswered: firstResponse.unanswered,
      },
      stages: stageTimes(stages),
      pauses: { completed: pauses.completed, withPause: pauses.paused.count, times: durationTimes(pauses.paused) },
      onTimeByService: onTimeGroups(byService),
      onTimeByPriority: onTimeGroups(
        PRIORITY_ORDER.map((priority) => {
          const row = byPriority.find((item) => item.priority === priority);
          return { label: PRIORITY_LABELS[priority], withDueDate: row?.withDueDate ?? 0, onTime: row?.onTime ?? 0 };
        }),
        "given",
      ),
      arrivals: arrivalGrid(arrivals),
      escalated,
      escalatedByRule,
      distributedAutomatically,
      overdueApprovals,
    },
    team: teamTable(team),
    satisfaction: satisfactionSummary(ratings),
  };
}
