import { approvalOverdue, pendingApprovalLevel, pendingApprovalSector } from "../domain/approval";

// Late approval levels, announced by the daily job (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 4.3.6, decision G6): once per level, only while the level is still pending and late. Nothing is
// decided automatically; the screens show the delay at reading time.

/** Requests checked per run; the rest wait for the next run. */
export const APPROVAL_DEADLINE_BATCH = 500;

export interface ApprovalDeadlineCandidate {
  id: string;
  sectorId: string;
  approvalState: "PENDING" | "APPROVED" | "REJECTED" | null;
  approvalLevel: number | null;
  approvalPendingSectorId: string | null;
  approvalDueAt: Date | null;
}

export interface ApprovalDeadlineStore {
  /** Pending levels whose due date passed at `now` and whose delay was not announced, oldest first. */
  findCandidates(now: Date, limit: number): Promise<ApprovalDeadlineCandidate[]>;
  /**
   * Marks the delay and records `request.approval_overdue` in one transaction, only while the
   * request is still pending at the level and due date read. Returns false when it changed.
   */
  markAndRecord(candidate: ApprovalDeadlineCandidate, alert: { level: number; sectorId: string }, now: Date): Promise<boolean>;
}

export interface ApprovalDeadlineSummary {
  overdue: number;
}

/** The level and sector to announce, or null when the candidate is not (or no longer) late. */
export function approvalOverdueAlert(candidate: ApprovalDeadlineCandidate, now: Date): { level: number; sectorId: string } | null {
  if (!approvalOverdue(candidate, now)) return null;
  const level = pendingApprovalLevel(candidate);
  const sectorId = pendingApprovalSector(candidate);
  return level !== null && sectorId !== null ? { level, sectorId } : null;
}

export async function recordApprovalDeadlineAlerts(
  now: Date,
  store: ApprovalDeadlineStore,
  limit: number = APPROVAL_DEADLINE_BATCH,
): Promise<ApprovalDeadlineSummary> {
  const summary: ApprovalDeadlineSummary = { overdue: 0 };

  for (const candidate of await store.findCandidates(now, limit)) {
    const alert = approvalOverdueAlert(candidate, now);

    if (alert && (await store.markAndRecord(candidate, alert, now))) {
      summary.overdue += 1;
    }
  }

  return summary;
}
