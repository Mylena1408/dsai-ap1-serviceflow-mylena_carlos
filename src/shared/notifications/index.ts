/** Kinds of notification (SPEC 2026-10-31-eventos-outbox-jobs, 8.1, and later SPECs). */
export type NotificationType =
  | "status.IN_PROGRESS"
  | "status.COMPLETED"
  | "status.CANCELLED"
  | "status.OPEN"
  | "assignment.received"
  | "comment.public"
  | "comment.internal"
  | "sla.warning"
  | "sla.breached"
  // SPEC 2026-11-06-escalonamento, 4.5.
  | "sla.escalated"
  | "stage.changed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "sector.received"
  | "sector.changed"
  | "document.added"
  | "sla.paused";

// Text of each notification (SPEC 2026-10-31-eventos-outbox-jobs, section 8.2), shared by the
// in-app list and the emails (SPEC 2026-11-01-notificacoes-email-preferencias, 5.4). Messages are
// built from the type and the service name; no comment, note or reason text is ever copied.

const MESSAGES: Record<NotificationType, (service: string, stage?: string) => string> = {
  "status.IN_PROGRESS": (service) => `Atendimento iniciado: ${service}`,
  "status.COMPLETED": (service) => `Solicitação concluída: ${service}`,
  "status.CANCELLED": (service) => `Solicitação cancelada: ${service}`,
  "status.OPEN": (service) => `Solicitação reaberta: ${service}`,
  "assignment.received": (service) => `Uma solicitação foi transferida para você: ${service}`,
  "comment.public": (service) => `Novo comentário em ${service}`,
  "comment.internal": (service) => `Nova nota interna em ${service}`,
  "sla.warning": (service) => `Prazo próximo do vencimento: ${service}`,
  "sla.breached": (service) => `Prazo vencido: ${service}`,
  "sla.escalated": (service) => `Solicitação vencida escalada: ${service}`,
  "approval.requested": (service) => `Aprovação pendente: ${service}`,
  "approval.approved": (service) => `Solicitação aprovada: ${service}`,
  "approval.rejected": (service) => `Solicitação rejeitada: ${service}`,
  // SPEC 2026-11-03-transferencia-entre-setores, 5.6.
  "sector.received": (service) => `Solicitação encaminhada ao seu setor: ${service}`,
  "sector.changed": (service) => `Solicitação encaminhada a outro setor: ${service}`,
  // SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.6.
  "document.added": (service) => `Novo documento em ${service}`,
  // SPEC 2026-11-03-pausa-sla-calendario, 5.6.
  "sla.paused": (service) => `Aguardando sua resposta: ${service}`,
  // The stage name is missing once the event is purged (after 30 days).
  "stage.changed": (service, stage) =>
    stage ? `Sua solicitação passou para a etapa ${stage}: ${service}` : `Sua solicitação mudou de etapa: ${service}`,
};

export interface MessageSource {
  type: NotificationType;
  serviceName: string;
  stageName?: string;
}

export function notificationMessage(notification: MessageSource): string {
  return (MESSAGES[notification.type] ?? ((service: string) => `Novidade em ${service}`))(
    notification.serviceName,
    notification.stageName,
  );
}

/**
 * Names of the email categories (SPEC 2026-11-01-notificacoes-email-preferencias, 5.1), shared by
 * the preferences page and "Meus dados" (SPEC 2026-11-02-auditoria-lgpd, 5.4).
 */
export const NOTIFICATION_CATEGORY_LABELS = {
  STATUS: "Mudanças de status",
  ASSIGNMENT: "Solicitações transferidas para você",
  COMMENTS: "Comentários e notas internas",
  SLA: "Prazos próximos e vencidos",
  STAGES: "Mudanças de etapa",
  APPROVALS: "Aprovações",
} as const;
