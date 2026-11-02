import type { EmailDeliveryRecord, EmailOverview, NotificationType } from "@/modules/notifications";

// "E-mails" (SPEC 2026-11-01-notificacoes-email-preferencias, 5.5): whether sending is configured,
// never the values of the variables, and the latest deliveries, never their content.

const TYPE_LABELS: Record<NotificationType, string> = {
  "status.IN_PROGRESS": "Atendimento iniciado",
  "status.COMPLETED": "Solicitação concluída",
  "status.CANCELLED": "Solicitação cancelada",
  "status.OPEN": "Solicitação reaberta",
  "assignment.received": "Transferência recebida",
  "comment.public": "Comentário",
  "comment.internal": "Nota interna",
  "sla.warning": "Prazo próximo",
  "sla.breached": "Prazo vencido",
  "stage.changed": "Mudança de etapa",
  "approval.requested": "Aprovação pendente",
  "approval.approved": "Solicitação aprovada",
  "approval.rejected": "Solicitação rejeitada",
};

const STATUS_LABELS: Record<EmailDeliveryRecord["status"], string> = {
  PENDING: "Pendente",
  SENT: "Enviado",
  FAILED: "Falhou",
  SKIPPED: "Não enviado",
};

const REASON_LABELS: Record<string, string> = {
  not_configured: "e-mail não configurado",
  recipient_inactive: "pessoa inativa",
  recipient_without_area: "perfil sem área de notificações",
};

function errorLabel(code: string): string {
  return REASON_LABELS[code] ?? `erro ${code}`;
}

function dateTime(value: Date) {
  return <time dateTime={value.toISOString()}>{value.toLocaleString("pt-BR")}</time>;
}

export function EmailsSection({ overview }: { overview: EmailOverview }) {
  return (
    <section className="admin-section" aria-labelledby="emails-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Notificações</p>
          <h2 id="emails-heading">E-mails</h2>
          <p className="section-description">
            Acompanhe os e-mails de notificação. Cada pessoa escolhe nas suas preferências o que recebe; o conteúdo dos
            e-mails não fica guardado.
          </p>
        </div>
      </div>
      <p className={`feedback${overview.configured ? "" : " feedback-error"}`} role="status">
        {overview.configured
          ? "Envio configurado."
          : "Envio não configurado: os e-mails ficam registrados como não enviados. Configure EMAIL_API_KEY, EMAIL_FROM e APP_BASE_URL no ambiente do servidor."}
      </p>
      {overview.deliveries.length === 0 ? (
        <p className="empty-state">Nenhum e-mail registrado ainda.</p>
      ) : (
        <>
          <p className="metadata">Os 50 envios mais recentes.</p>
          <ul className="entity-list email-delivery-list">
            {overview.deliveries.map((delivery) => (
              <li key={delivery.id}>
                <p>
                  <strong>{STATUS_LABELS[delivery.status]}</strong> · {TYPE_LABELS[delivery.type] ?? delivery.type} para{" "}
                  {delivery.recipientName} ({delivery.recipientEmail})
                </p>
                <p className="metadata">
                  Registrado em {dateTime(delivery.createdAt)}
                  {delivery.sentAt ? <> · enviado em {dateTime(delivery.sentAt)}</> : null}
                  {" · "}
                  {delivery.attempts === 1 ? "1 tentativa" : `${delivery.attempts} tentativas`}
                  {delivery.lastErrorCode ? <> · {errorLabel(delivery.lastErrorCode)}</> : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
