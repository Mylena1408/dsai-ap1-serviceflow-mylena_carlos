// The daily job applies the sectors' escalation rules (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 7.3 items 2 to 4): each rule once per request and due date, never during the pause. Each
// application raises the priority, hands the request over and warns people as the rule says, in one
// transaction with its history and events. Nobody is warned twice about a request in the same run.

/** Pairs (request, rule) checked per run; the rest wait for the next run. */
export const ESCALATION_RULE_BATCH = 500;

export interface RuleCandidate {
  requestId: string;
  ruleId: string;
  /** The due date read, the key of "once per due date". */
  dueAt: Date;
}

export interface RuleApplication {
  /** Raised the priority. */
  raised: boolean;
  /** Handed the request over. */
  assigned: boolean;
  /** Who was warned. */
  warned: string[];
}

export interface EscalationRuleRunStore {
  /** Pairs whose trigger holds at `now` and that were not applied to that due date, oldest due first. */
  findCandidates(now: Date, limit: number): Promise<RuleCandidate[]>;
  /**
   * Re-reads the request and the rule and applies it, or returns null when it no longer applies
   * (or another run applied it first). `alreadyWarned` are the people this run warned about the
   * request.
   */
  apply(candidate: RuleCandidate, now: Date, alreadyWarned: ReadonlySet<string>): Promise<RuleApplication | null>;
}

export interface EscalationRuleSummary {
  applied: number;
  raised: number;
  assigned: number;
  warned: number;
}

export async function applyEscalationRules(
  now: Date,
  store: EscalationRuleRunStore,
  limit: number = ESCALATION_RULE_BATCH,
): Promise<EscalationRuleSummary> {
  const summary: EscalationRuleSummary = { applied: 0, raised: 0, assigned: 0, warned: 0 };
  const warnedByRequest = new Map<string, Set<string>>();

  for (const candidate of await store.findCandidates(now, limit)) {
    const warned = warnedByRequest.get(candidate.requestId) ?? new Set<string>();
    const result = await store.apply(candidate, now, warned);

    if (!result) continue;

    summary.applied += 1;
    if (result.raised) summary.raised += 1;
    if (result.assigned) summary.assigned += 1;
    summary.warned += result.warned.length;
    for (const id of result.warned) warned.add(id);
    warnedByRequest.set(candidate.requestId, warned);
  }

  return summary;
}
