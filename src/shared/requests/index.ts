// Names of request values as people read them, shared by the screens and the CSV export
// (SPEC 2026-11-02-painel-relatorios, 5.4). No server imports, so client components can use it.

export type StatusValue = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type PriorityValue = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ApprovalStateValue = "PENDING" | "APPROVED" | "REJECTED";
export type SlaSituationValue = "none" | "on_time" | "due_soon" | "overdue" | "completed_on_time" | "completed_late";

export const REQUEST_STATUS_LABELS: Record<StatusValue, string> = {
  OPEN: "Aberta",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

/** SPEC 2026-11-01-sla-prioridades, section 5.1. */
export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

/** SPEC 2026-11-01-aprovacoes, 5.7. */
export const APPROVAL_LABELS = {
  PENDING: "Aguardando aprovação",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
} as const satisfies Record<ApprovalStateValue, string>;

/** SPEC 2026-11-01-sla-prioridades, sections 5.4 and 5.6. */
export const SLA_SITUATION_LABELS: Record<SlaSituationValue, string> = {
  none: "Sem prazo",
  on_time: "Dentro do prazo",
  due_soon: "Próximo do vencimento",
  overdue: "Vencido",
  completed_on_time: "Concluída no prazo",
  completed_late: "Concluída com atraso",
};

/** The first block of the identifier, as people quote a request in a conversation. */
export function requestShortCode(requestId: string): string {
  return requestId.slice(0, 8).toUpperCase();
}
