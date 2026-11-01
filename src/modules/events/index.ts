import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { processOutbox, type OutboxRunSummary } from "./application/process-outbox";
import type { EventConsumer } from "./application/ports";
import { createPrismaOutboxStore } from "./infrastructure/prisma-outbox";

// Outbox events (SPEC 2026-10-31-eventos-outbox-jobs). Other modules record events inside
// their own transactions through `recordOutboxEvent`; consumers are registered by the
// composition in src/server/jobs.
export { DOMAIN_EVENT_TYPES, outboxPayload } from "./domain/domain-event";
export type { DomainEvent, DomainEventType, EventRequestStatus } from "./domain/domain-event";
export { MAX_EVENT_ATTEMPTS, retryDelayMs } from "./domain/retry";
export { recordOutboxEvent } from "./infrastructure/prisma-outbox";
export type { ClaimedEvent, EventConsumer } from "./application/ports";
export type { OutboxRunSummary } from "./application/process-outbox";

export async function runOutbox(
  consumers: readonly EventConsumer[],
  options: { maxBatches?: number } = {},
  database: PrismaClient = prisma,
): Promise<OutboxRunSummary> {
  return processOutbox(createPrismaOutboxStore(database), consumers, options);
}

/** Deletes events processed before `before` (daily cleanup, section 7). */
export async function purgeProcessedEvents(before: Date, database: PrismaClient = prisma): Promise<number> {
  return createPrismaOutboxStore(database).purgeProcessed(before);
}
