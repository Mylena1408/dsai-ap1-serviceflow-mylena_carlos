// Names of request values as people read them, shared by the screens and the CSV export
// (SPEC 2026-11-02-painel-relatorios, 5.4). No server imports, so client components can use it.

export type StatusValue = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type PriorityValue = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ApprovalStateValue = "PENDING" | "APPROVED" | "REJECTED";
export type SlaSituationValue =
  | "none"
  | "on_time"
  | "due_soon"
  | "overdue"
  | "completed_on_time"
  | "completed_late"
  | "paused";

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

/** What escalated a request (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.1). */
export const ESCALATION_TRIGGERS = ["OVERDUE", "DUE_SOON", "OVERDUE_DAYS"] as const;
export type EscalationTriggerValue = (typeof ESCALATION_TRIGGERS)[number];

export const ESCALATION_TRIGGER_LABELS: Record<EscalationTriggerValue, string> = {
  OVERDUE: "Vencida (opção do setor)",
  DUE_SOON: "Próxima do vencimento",
  OVERDUE_DAYS: "Vencida há N dias",
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
  // SPEC 2026-11-03-pausa-sla-calendario, 5.3.
  paused: "Prazo pausado",
};

/** The first block of the identifier, as people quote a request in a conversation. */
export function requestShortCode(requestId: string): string {
  return requestId.slice(0, 8).toUpperCase();
}
