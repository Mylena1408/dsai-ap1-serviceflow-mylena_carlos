import {
  EVENT_CLAIM_LEASE_MS,
  MAX_EVENT_ATTEMPTS,
  failureCode,
  retryDelayMs,
} from "../domain/retry";
import type { EventConsumer, OutboxStore } from "./ports";

export const EVENT_BATCH_SIZE = 50;

export interface OutboxRunSummary {
  processed: number;
  retried: number;
  failed: number;
}

/**
 * Processes available events in batches (SPEC 2026-10-31-eventos-outbox-jobs, section 6.2).
 * Each event goes to every consumer; any failure schedules a retry with a growing wait,
 * recorded by code only, and the event is marked failed after the last attempt.
 */
export async function processOutbox(
  store: OutboxStore,
  consumers: readonly EventConsumer[],
  options: { maxBatches?: number; batchSize?: number } = {},
): Promise<OutboxRunSummary> {
  const summary: OutboxRunSummary = { processed: 0, retried: 0, failed: 0 };
  const batchSize = options.batchSize ?? EVENT_BATCH_SIZE;

  for (let batch = 0; batch < (options.maxBatches ?? 1); batch += 1) {
    const { events, now } = await store.claim(batchSize, EVENT_CLAIM_LEASE_MS);

    for (const event of events) {
      try {
        for (const consumer of consumers) {
          await consumer.handle(event);
        }
        await store.markProcessed(event.id, now);
        summary.processed += 1;
      } catch (error) {
        const attempts = event.attempts + 1;
        const code = failureCode(error);

        if (attempts >= MAX_EVENT_ATTEMPTS) {
          await store.markFailed(event.id, attempts, now, code);
          summary.failed += 1;
        } else {
          await store.markRetry(event.id, attempts, new Date(now.getTime() + retryDelayMs(attempts)), code);
          summary.retried += 1;
        }
      }
    }

    if (events.length < batchSize) {
      break;
    }
  }

  return summary;
}
