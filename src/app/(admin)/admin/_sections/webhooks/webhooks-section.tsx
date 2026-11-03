import {
  MAX_WEBHOOKS,
  WEBHOOK_ENV_NAMES,
  WEBHOOK_EVENT_LABELS,
  canResendWebhookDelivery,
  type WebhookDeliveryRecord,
  type WebhookOverview,
} from "@/modules/webhooks";
import {
  createWebhookAction,
  resendWebhookDeliveryAction,
  rotateWebhookSecretAction,
  setWebhookActiveAction,
  updateWebhookAction,
} from "./actions";
import { WebhookCreateForm, WebhookRotateForm, WebhookSectorOptions } from "./webhook-forms";

// "Webhooks" (SPEC 2026-11-02-api-externa-webhooks, 5.6; decision A5): registration by the
// administrator, whether the key is configured (by its name, never its value) and the latest
// deliveries, never their body.

const EVENTS = Object.entries(WEBHOOK_EVENT_LABELS).map(([type, label]) => ({ type, label }));

const STATUS_LABELS: Record<WebhookDeliveryRecord["status"], string> = {
  PENDING: "Pendente",
  DELIVERED: "Entregue",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

const ERROR_LABELS: Record<string, string> = {
  TIMEOUT: "sem resposta em 10 s",
  NETWORK: "falha de rede",
  BLOCKED_ADDRESS: "endereço interno recusado",
  REDIRECT: "redirecionamento recusado",
  SECRET_UNAVAILABLE: "segredo ilegível com a chave atual",
};

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? (code.startsWith("HTTP_") ? `resposta ${code.slice(5)}` : code);
}

/** SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2. */
function sectorNames(sectorIds: readonly string[], sectors: WebhookOverview["sectors"]): string {
  if (sectorIds.length === 0) return "Todos os setores";
  return sectorIds.map((id) => sectors.find((sector) => sector.id === id)?.name ?? "(setor removido)").join(", ");
}

function eventLabel(type: string): string {
  return (WEBHOOK_EVENT_LABELS as Record<string, string>)[type] ?? type;
}

function dateTime(value: Date) {
  return <time dateTime={value.toISOString()}>{value.toLocaleString("pt-BR")}</time>;
}

export function WebhooksSection({ overview }: { overview: WebhookOverview }) {
  const disabled = !overview.configured;

  return (
    <section className="admin-section" aria-labelledby="webhooks-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Integrações</p>
          <h2 id="webhooks-heading">Webhooks</h2>
          <p className="section-description">
            Avise outro sistema quando algo acontece com as solicitações. Cada entrega leva só identificadores e códigos,
            assinados com o segredo do webhook; nunca descrições, comentários, nomes ou e-mails. Até {MAX_WEBHOOKS} ativos.
          </p>
        </div>
      </div>
      <p className={`feedback${overview.configured ? "" : " feedback-error"}`} role="status">
        {overview.configured
          ? "Webhooks configurados."
          : `Webhooks não configurados: nada é cadastrado nem enviado. Configure ${WEBHOOK_ENV_NAMES.join(", ")} no ambiente do servidor.`}
      </p>

      <WebhookCreateForm action={createWebhookAction} disabled={disabled} events={EVENTS} sectors={overview.sectors} />

      {overview.webhooks.length === 0 ? (
        <p className="empty-state">Nenhum webhook cadastrado.</p>
      ) : (
        <ul className="entity-list webhook-list">
          {overview.webhooks.map((webhook) => (
            <li className="entity-item" key={webhook.id}>
              <div className="entity-record-content">
                <div className="entity-summary">
                  <strong>{webhook.name}</strong>
                  <span className={`status-badge${webhook.isActive ? "" : " is-inactive"}`}>{webhook.isActive ? "Ativo" : "Inativo"}</span>
                </div>
                <div className="entity-details">
                  <span>{webhook.url}</span>
                  <span>{webhook.eventTypes.map(eventLabel).join(", ")}</span>
                  <span>{sectorNames(webhook.sectorIds, overview.sectors)}</span>
                </div>
                <details>
                  <summary>Editar</summary>
                  <form action={updateWebhookAction} className="create-form">
                    <input name="webhookId" type="hidden" value={webhook.id} />
                    <label>
                      Nome
                      <input defaultValue={webhook.name} maxLength={60} name="name" required type="text" />
                    </label>
                    <label>
                      Endereço (https)
                      <input defaultValue={webhook.url} maxLength={2000} name="url" required type="url" />
                    </label>
                    <fieldset className="format-options">
                      <legend>Eventos</legend>
                      {EVENTS.map((event) => (
                        <label className="checkbox-field" key={event.type}>
                          <input defaultChecked={webhook.eventTypes.includes(event.type as never)} name="eventTypes" type="checkbox" value={event.type} />
                          {event.label}
                        </label>
                      ))}
                    </fieldset>
                    <WebhookSectorOptions checked={webhook.sectorIds} sectors={overview.sectors} />
                    <button type="submit">Salvar</button>
                  </form>
                </details>
              </div>
              <div>
                <form action={setWebhookActiveAction} className="entity-actions">
                  <input name="webhookId" type="hidden" value={webhook.id} />
                  <input name="isActive" type="hidden" value={webhook.isActive ? "false" : "true"} />
                  <button className={webhook.isActive ? "button-danger" : "button-secondary"} type="submit">
                    {webhook.isActive ? "Desativar" : "Reativar"}
                  </button>
                </form>
                <WebhookRotateForm action={rotateWebhookSecretAction} disabled={disabled} webhookId={webhook.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Entregas recentes</h3>
      {overview.deliveries.length === 0 ? (
        <p className="empty-state">Nenhuma entrega registrada.</p>
      ) : (
        <ul className="content-list webhook-deliveries">
          {overview.deliveries.map((delivery) => (
            <li key={delivery.id}>
              <strong>
                {STATUS_LABELS[delivery.status]} · {eventLabel(delivery.eventType)} · {delivery.webhookName}
              </strong>
              <p className="metadata">
                Registrada em {dateTime(delivery.createdAt)}
                {delivery.deliveredAt ? <> · entregue em {dateTime(delivery.deliveredAt)}</> : null} · {delivery.attempts}{" "}
                {delivery.attempts === 1 ? "tentativa" : "tentativas"}
                {delivery.lastErrorCode ? ` · ${errorLabel(delivery.lastErrorCode)}` : ""}
              </p>
              {canResendWebhookDelivery(delivery, { isActive: delivery.webhookActive }) ? (
                <form action={resendWebhookDeliveryAction} className="entity-actions">
                  <input name="deliveryId" type="hidden" value={delivery.id} />
                  <button className="button-secondary" type="submit">
                    Reenviar
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
