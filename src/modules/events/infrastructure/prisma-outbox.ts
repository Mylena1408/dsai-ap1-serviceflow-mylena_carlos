import type { Prisma } from "@prisma/client";
import { outboxPayload, type DomainEvent } from "../domain/domain-event";

/**
 * Writes the event with the caller's transaction client, so the event exists exactly when
 * the change that produced it commits (SPEC 2026-10-31-eventos-outbox-jobs, section 6.2).
 */
export async function recordOutboxEvent(
  transaction: Prisma.TransactionClient,
  event: DomainEvent,
): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      type: event.type,
      requestId: event.requestId,
      payload: outboxPayload(event),
      occurredAt: event.occurredAt,
      availableAt: event.occurredAt,
    },
  });
}
