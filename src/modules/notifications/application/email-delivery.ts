import { failureCode } from "@/modules/events";
import { buildNotificationEmail, type EmailRecipientRole } from "../domain/email-content";
import { nextDeliveryState, type EmailDeliveryOutcome } from "../domain/email";
import type { EmailDeliveryStore, EmailTransport, PendingEmailDelivery } from "./ports";

// Sending of pending emails (SPEC 2026-11-01-notificacoes-email-preferencias, 5.3). Runs after the
// response and in the daily job, never inside the user's action.

export const EMAIL_BATCH_SIZE = 50;
/** How long a claimed delivery stays reserved for the run that claimed it. */
export const EMAIL_CLAIM_LEASE_MS = 5 * 60 * 1000;

export interface EmailRunSummary {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

/** A configured sender, or null when email is not configured (5.3.2). */
export interface EmailSender {
  transport: EmailTransport;
  /** APP_BASE_URL, the origin used in the links. */
  baseUrl: string;
}

const AREA_ROLES = new Set<string>(["REQUESTER", "ATTENDANT", "MANAGER"]);

async function deliver(delivery: PendingEmailDelivery, sender: EmailSender | null): Promise<EmailDeliveryOutcome> {
  if (!sender) return { kind: "skipped", reason: "not_configured" };
  if (!delivery.recipient.isActive) return { kind: "skipped", reason: "recipient_inactive" };
  if (!AREA_ROLES.has(delivery.recipient.role)) return { kind: "skipped", reason: "recipient_without_area" };

  const content = buildNotificationEmail(
    { ...delivery.notification, recipientRole: delivery.recipient.role as EmailRecipientRole },
    sender.baseUrl,
  );

  try {
    await sender.transport.send({ to: delivery.recipient.email, ...content });
    return { kind: "sent" };
  } catch (error) {
    // Only the code is kept: messages may carry the address or the provider response.
    return { kind: "failed", code: failureCode(error) };
  }
}

export async function processEmailDeliveries(
  store: EmailDeliveryStore,
  sender: EmailSender | null,
  options: { maxBatches?: number; batchSize?: number } = {},
): Promise<EmailRunSummary> {
  const summary: EmailRunSummary = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  const batchSize = options.batchSize ?? EMAIL_BATCH_SIZE;

  for (let batch = 0; batch < (options.maxBatches ?? 1); batch += 1) {
    const { deliveries, now } = await store.claimPending(batchSize, EMAIL_CLAIM_LEASE_MS);

    for (const delivery of deliveries) {
      const { status, attempts, availableAt, sentAt, lastErrorCode } = delivery;
      const state = { status, attempts, availableAt, sentAt, lastErrorCode };
      const next = nextDeliveryState(state, await deliver(delivery, sender), now);
      await store.save(delivery.id, next);

      if (next.status === "SENT") summary.sent += 1;
      else if (next.status === "SKIPPED") summary.skipped += 1;
      else if (next.status === "FAILED") summary.failed += 1;
      else summary.retried += 1;
    }

    if (deliveries.length < batchSize) {
      break;
    }
  }

  return summary;
}
