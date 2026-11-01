import { pendingSlaAlert, type SlaAlertKind, type SlaAlertState } from "../domain/sla";

// SLA alerts of the daily job (SPEC 2026-11-01-sla-prioridades, section 5.5, SF-069).

/** Requests checked per run; the rest wait for the next run. */
export const SLA_ALERT_BATCH = 500;

export interface SlaAlertCandidate extends SlaAlertState {
  id: string;
}

export interface SlaAlertStore {
  /** Open or in-progress requests that may owe an alert at `now`, nearest due date first. */
  findCandidates(now: Date, limit: number): Promise<SlaAlertCandidate[]>;
  /**
   * Marks the alert and records its event in one transaction, only while the request is
   * still as read (status, due date and marks). Returns false when it changed meanwhile.
   */
  markAndRecord(candidate: SlaAlertCandidate, kind: SlaAlertKind, now: Date): Promise<boolean>;
}

export interface SlaAlertSummary {
  warnings: number;
  breaches: number;
}

export async function recordSlaAlerts(
  now: Date,
  store: SlaAlertStore,
  limit: number = SLA_ALERT_BATCH,
): Promise<SlaAlertSummary> {
  const summary: SlaAlertSummary = { warnings: 0, breaches: 0 };

  for (const candidate of await store.findCandidates(now, limit)) {
    const kind = pendingSlaAlert(candidate, now);

    if (kind && (await store.markAndRecord(candidate, kind, now))) {
      if (kind === "warning") summary.warnings += 1;
      else summary.breaches += 1;
    }
  }

  return summary;
}
