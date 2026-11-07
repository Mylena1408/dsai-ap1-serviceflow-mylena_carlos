// Late stages, announced by the daily job (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.2,
// decisions G10 and G12): once per stage entry, while the request is still in the attendance at
// that stage. The pause "aguardando o solicitante" does not stop the stage target, and the SLA does
// not change. The screens show the delay at reading time.

/** Requests checked per run; the rest wait for the next run. */
export const STAGE_DEADLINE_BATCH = 500;

export interface StageDeadlineCandidate {
  id: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  stageIndex: number | null;
  stageDueAt: Date | null;
}

export interface StageDeadlineStore {
  /** In-progress requests whose stage passed its due date and was not announced, oldest first. */
  findCandidates(now: Date, limit: number): Promise<StageDeadlineCandidate[]>;
  /**
   * Marks the delay and records `request.stage_overdue` in one transaction, only while the request
   * is still in progress at the stage and due date read. Returns false when it changed meanwhile.
   */
  markAndRecord(candidate: StageDeadlineCandidate, stageIndex: number, now: Date): Promise<boolean>;
}

export interface StageDeadlineSummary {
  overdue: number;
}

/** The stage to announce, or null when the candidate is not (or no longer) late. */
export function stageOverdueAlert(candidate: StageDeadlineCandidate, now: Date): number | null {
  if (candidate.status !== "IN_PROGRESS" || candidate.stageIndex === null || !candidate.stageDueAt) return null;
  return candidate.stageDueAt.getTime() <= now.getTime() ? candidate.stageIndex : null;
}

export async function recordStageDeadlineAlerts(
  now: Date,
  store: StageDeadlineStore,
  limit: number = STAGE_DEADLINE_BATCH,
): Promise<StageDeadlineSummary> {
  const summary: StageDeadlineSummary = { overdue: 0 };

  for (const candidate of await store.findCandidates(now, limit)) {
    const stageIndex = stageOverdueAlert(candidate, now);

    if (stageIndex !== null && (await store.markAndRecord(candidate, stageIndex, now))) {
      summary.overdue += 1;
    }
  }

  return summary;
}
