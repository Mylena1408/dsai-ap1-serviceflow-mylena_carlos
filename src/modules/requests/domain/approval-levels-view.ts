import { approvalOverdue, pendingApprovalLevel, requestApprovalSectors } from "./approval";
import type { RequestWithHistory } from "./request";

// The approval levels of a request as the screens show them (SPEC
// 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6): one line per level, with its
// sector, the decision when there is one, the pending level's due date and delay, and the levels
// still to come.

export type ApprovalLevelSituation = "approved" | "rejected" | "pending" | "waiting" | "not_reached";

export interface ApprovalLevelLine {
  level: number;
  sectorName: string;
  situation: ApprovalLevelSituation;
  decider: string | null;
  onBehalfOf: string | null;
  decidedAt: Date | null;
  note: string | null;
  dueAt: Date | null;
  overdue: boolean;
}

export interface ApprovalLevelsView {
  levelCount: number;
  lines: ApprovalLevelLine[];
}

type ViewRequest = Pick<
  RequestWithHistory,
  "sectorId" | "approvalState" | "approvalSectorIdsSnapshot" | "approvalLevel" | "approvalDueAt" | "approval" | "approvals"
>;

/**
 * Null when the request does not require approval. A level after a rejection was never reached;
 * a level after the pending one waits for it.
 */
export function approvalLevelsView(
  request: ViewRequest,
  sectorNames: ReadonlyMap<string, string>,
  now: Date,
): ApprovalLevelsView | null {
  if (request.approvalState === null) {
    return null;
  }

  const sectors = requestApprovalSectors(request);
  const decisions = request.approvals ?? (request.approval ? [request.approval] : []);
  const pendingLevel = pendingApprovalLevel(request);
  const rejectedAt = decisions.find((decision) => decision.decision === "REJECTED")?.level ?? null;

  const lines = sectors.map((sectorId, index): ApprovalLevelLine => {
    const level = index + 1;
    const decision = decisions.find((item) => (item.level ?? 1) === level) ?? null;
    const isPending = pendingLevel === level;
    let situation: ApprovalLevelSituation;
    if (decision) situation = decision.decision === "APPROVED" ? "approved" : "rejected";
    else if (isPending) situation = "pending";
    else if (rejectedAt !== null && level > (rejectedAt ?? 1)) situation = "not_reached";
    else situation = pendingLevel !== null && level > pendingLevel ? "waiting" : "not_reached";

    return {
      level,
      sectorName: sectorNames.get(sectorId) ?? "Setor removido",
      situation,
      decider: decision?.decider.name ?? null,
      onBehalfOf: decision?.onBehalfOf?.name ?? null,
      decidedAt: decision?.decidedAt ?? null,
      note: decision?.note ?? null,
      dueAt: isPending ? (request.approvalDueAt ?? null) : null,
      overdue: isPending && approvalOverdue(request, now),
    };
  });

  return { levelCount: sectors.length, lines };
}

const SITUATION_TEXT: Record<ApprovalLevelSituation, string> = {
  approved: "Aprovado",
  rejected: "Rejeitado",
  pending: "Aguardando decisão",
  waiting: "Aguardando o nível anterior",
  not_reached: "Não chegou a este nível",
};

/** "Aprovado por Gabi, substituindo Paulo" and similar, without dates (the screen formats them). */
export function approvalLevelText(line: ApprovalLevelLine): string {
  const base = SITUATION_TEXT[line.situation];
  if (!line.decider) return line.overdue ? `${base} — atrasado` : base;
  return `${base} por ${line.decider}${line.onBehalfOf ? `, substituindo ${line.onBehalfOf}` : ""}`;
}
