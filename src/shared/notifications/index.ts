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
  | "stage.changed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected";

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
  "approval.requested": (service) => `Aprovação pendente: ${service}`,
  "approval.approved": (service) => `Solicitação aprovada: ${service}`,
  "approval.rejected": (service) => `Solicitação rejeitada: ${service}`,
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
