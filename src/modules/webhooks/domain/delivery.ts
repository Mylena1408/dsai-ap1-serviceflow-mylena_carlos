import type { DomainEventType } from "@/modules/events";

// Webhook registration and delivery rules (SPEC 2026-11-02-api-externa-webhooks, 5.6).

export const MAX_WEBHOOKS = 10;
export const WEBHOOK_NAME_MAX_LENGTH = 60;
export const MAX_WEBHOOK_ATTEMPTS = 6;
export const WEBHOOK_TIMEOUT_MS = 10_000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** Waits before the 2nd to the 6th attempt: 1 min, 5 min, 30 min, 2 h and 12 h. */
export const WEBHOOK_RETRY_DELAYS_MS: readonly number[] = [MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * HOUR_MS, 12 * HOUR_MS];

/** Names of the event types on the webhook form and in the delivery list. */
export const WEBHOOK_EVENT_LABELS: Record<DomainEventType, string> = {
  "request.opened": "Solicitação aberta",
  "request.status_changed": "Mudança de status",
  "request.assignment_changed": "Mudança de responsável",
  "request.comment_added": "Comentário ou nota interna",
  "request.priority_changed": "Mudança de prioridade",
  "request.sla_warning": "Prazo próximo do vencimento",
  "request.sla_breached": "Prazo vencido",
  "request.stage_changed": "Mudança de etapa",
  "request.approval_decided": "Decisão de aprovação",
  "request.sector_changed": "Mudança de setor",
  "request.document_added": "Documento enviado",
  "request.sla_paused": "Prazo pausado",
  "request.sla_resumed": "Prazo retomado",
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6.
  "request.approval_overdue": "Aprovação atrasada",
};

export function normalizeWebhookName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && [...name].length <= WEBHOOK_NAME_MAX_LENGTH ? name : null;
}

/** The selected types without repetition, or null when none is selected or one is unknown. */
export function checkWebhookEvents(
  selected: readonly string[],
  known: readonly DomainEventType[],
): DomainEventType[] | null {
  const unique = [...new Set(selected)];
  if (unique.length === 0 || unique.some((type) => !known.includes(type as DomainEventType))) return null;
  return known.filter((type) => unique.includes(type));
}

export interface WebhookEvent {
  id: string;
  type: DomainEventType;
  occurredAt: Date;
  requestId: string;
  /** The outbox payload: identifiers and codes only (SPEC de eventos, 6.1). */
  payload: Record<string, unknown>;
}

/**
 * Body of a delivery (5.6): exactly the outbox content, with a fixed key order so the signed text
 * is the same in every attempt. Never descriptions, comments, notes, answers, names or e-mails.
 */
export function webhookBody(event: WebhookEvent): string {
  return JSON.stringify({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    requestId: event.requestId,
    data: event.payload,
  });
}

export type WebhookAttemptResult =
  | { kind: "response"; status: number }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "blocked" };

/** Only 2xx is success; a redirect is not followed and counts as a failure. */
export function webhookFailureCode(result: WebhookAttemptResult): string | null {
  switch (result.kind) {
    case "response":
      if (result.status >= 200 && result.status < 300) return null;
      return result.status >= 300 && result.status < 400 ? "REDIRECT" : `HTTP_${result.status}`;
    case "timeout":
      return "TIMEOUT";
    case "network":
      return "NETWORK";
    case "blocked":
      return "BLOCKED_ADDRESS";
  }
}

export type WebhookRetryPlan = { status: "PENDING"; availableAt: Date } | { status: "FAILED" };

/** After a failed attempt (`attempts` already counts it): wait for the next one, or give up after 6. */
export function webhookRetryPlan(attempts: number, now: Date): WebhookRetryPlan {
  if (attempts >= MAX_WEBHOOK_ATTEMPTS) return { status: "FAILED" };
  const delay = WEBHOOK_RETRY_DELAYS_MS[attempts - 1] ?? WEBHOOK_RETRY_DELAYS_MS.at(-1)!;
  return { status: "PENDING", availableAt: new Date(now.getTime() + delay) };
}

/**
 * SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2 (decision W2): a webhook without sectors receives
 * every sector; with sectors, only events of requests opened in one of them.
 */
export function webhookAcceptsSector(webhookSectorIds: readonly string[], requestSectorId: string): boolean {
  return webhookSectorIds.length === 0 || webhookSectorIds.includes(requestSectorId);
}

/**
 * Sectors an event belongs to for the filter (SPEC 2026-11-03-transferencia-entre-setores, 5.7,
 * decision T6): a move belongs to its origin and its destination; null for every other event,
 * which belongs to the request's current sector.
 */
export function eventSectorIds(type: string, payload: Record<string, unknown>): string[] | null {
  if (type !== "request.sector_changed") return null;
  return [payload.fromSectorId, payload.toSectorId].filter((value): value is string => typeof value === "string");
}

/** The sectors of the form without repetition; null when one of them does not exist. */
export function checkWebhookSectors(selected: readonly string[], existing: readonly string[]): string[] | null {
  const unique = [...new Set(selected)];
  return unique.every((sectorId) => existing.includes(sectorId)) ? unique : null;
}

/**
 * Section 5.3 (decision W3): only a delivery that ended without success (failed or cancelled), of a
 * webhook still active, goes back to the queue.
 */
export function canResendWebhookDelivery(delivery: { status: string }, webhook: { isActive: boolean }): boolean {
  return webhook.isActive && (delivery.status === "FAILED" || delivery.status === "CANCELLED");
}
