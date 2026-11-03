import type { ClaimedEvent, EventConsumer } from "@/modules/events";
import { eventSectorIds, webhookAcceptsSector, webhookBody, webhookFailureCode, webhookRetryPlan } from "../domain/delivery";
import { decryptWebhookSecret, webhookSignature } from "../domain/secret";
import type { PendingWebhookDelivery, WebhookDeliveryStore, WebhookDeliveryUpdate, WebhookTransport } from "./ports";

// Deliveries of the webhooks (SPEC 2026-11-02-api-externa-webhooks, 5.6). The consumer only records
// them; the sending runs right after the response and in the daily job, never inside the action.

export const WEBHOOK_BATCH_SIZE = 25;
/** How long a claimed delivery stays reserved for the run that claimed it (10 s per call, with margin). */
export const WEBHOOK_CLAIM_LEASE_MS = 10 * 60 * 1000;

export interface WebhookRunSummary {
  delivered: number;
  retried: number;
  failed: number;
  cancelled: number;
}

export interface WebhookSender {
  transport: WebhookTransport;
  key: Buffer;
}

/**
 * Records one delivery per active webhook that subscribes to the event, with the body built now
 * (the outbox event is purged after 30 days). Without the encryption key nothing is recorded.
 */
export function createWebhookConsumer(store: WebhookDeliveryStore, configured: () => boolean): EventConsumer {
  return {
    name: "webhooks",
    async handle(event: ClaimedEvent) {
      if (!configured()) return;
      let subscribers = await store.subscribers(event.type);
      // SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2: the sector is read only when a webhook filters.
      // A move to another sector belongs to both sectors (SPEC de transferência entre setores, 5.7).
      if (subscribers.some(({ sectorIds }) => sectorIds.length > 0)) {
        const eventSectors =
          eventSectorIds(event.type, event.payload) ??
          [await store.requestSector(event.requestId)].filter((sectorId): sectorId is string => sectorId !== null);
        subscribers = subscribers.filter(({ sectorIds }) =>
          eventSectors.some((sectorId) => webhookAcceptsSector(sectorIds, sectorId)),
        );
      }
      if (subscribers.length === 0) return;

      const body = webhookBody({ id: event.id, type: event.type, occurredAt: event.occurredAt, requestId: event.requestId, payload: event.payload });
      await store.register(
        subscribers.map(({ id }) => ({ endpointId: id, eventId: event.id, eventType: event.type, body, at: event.occurredAt })),
      );
    },
  };
}

async function attempt(delivery: PendingWebhookDelivery, sender: WebhookSender, now: Date): Promise<WebhookDeliveryUpdate> {
  if (!delivery.endpoint.isActive) return { status: "CANCELLED" };

  const attempts = delivery.attempts + 1;
  let code: string | null;
  try {
    const secret = decryptWebhookSecret(delivery.endpoint.encryptedSecret, sender.key);
    const signature = webhookSignature(delivery.body, secret, Math.floor(now.getTime() / 1000));
    code = webhookFailureCode(
      await sender.transport.post(delivery.endpoint.url, { deliveryId: delivery.id, eventType: delivery.eventType, body: delivery.body, signature }),
    );
  } catch {
    // A secret that no longer decrypts (key changed) cannot be signed: counted as an attempt.
    code = "SECRET_UNAVAILABLE";
  }

  if (code === null) return { status: "DELIVERED", attempts, deliveredAt: now };
  const plan = webhookRetryPlan(attempts, now);
  return plan.status === "FAILED"
    ? { status: "FAILED", attempts, lastErrorCode: code }
    : { status: "PENDING", attempts, availableAt: plan.availableAt, lastErrorCode: code };
}

/** Sends the due deliveries in batches; without the key (`sender` null) nothing is sent. */
export async function processWebhookDeliveries(
  store: WebhookDeliveryStore,
  sender: WebhookSender | null,
  options: { maxBatches?: number; batchSize?: number } = {},
): Promise<WebhookRunSummary> {
  const summary: WebhookRunSummary = { delivered: 0, retried: 0, failed: 0, cancelled: 0 };
  if (!sender) return summary;
  const batchSize = options.batchSize ?? WEBHOOK_BATCH_SIZE;

  for (let batch = 0; batch < (options.maxBatches ?? 1); batch += 1) {
    const { deliveries, now } = await store.claimPending(batchSize, WEBHOOK_CLAIM_LEASE_MS);

    for (const delivery of deliveries) {
      const update = await attempt(delivery, sender, now);
      await store.save(delivery.id, update);
      if (update.status === "DELIVERED") summary.delivered += 1;
      else if (update.status === "CANCELLED") summary.cancelled += 1;
      else if (update.status === "FAILED") summary.failed += 1;
      else summary.retried += 1;
    }

    if (deliveries.length < batchSize) break;
  }

  return summary;
}
