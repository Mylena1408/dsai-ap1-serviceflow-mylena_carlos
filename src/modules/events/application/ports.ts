import type { DomainEventType } from "../domain/domain-event";

/** An outbox event claimed for processing. */
export interface ClaimedEvent {
  id: string;
  type: DomainEventType;
  requestId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
}

/**
 * Reacts to events. Delivery is at least once, so a consumer must be idempotent
 * (SPEC 2026-10-31-eventos-outbox-jobs, section 6.2 item 2).
 */
export interface EventConsumer {
  name: string;
  handle(event: ClaimedEvent): Promise<void>;
}

export interface OutboxStore {
  /**
   * Reserves up to `limit` available events in creation order, skipping rows another
   * processor holds, and returns them with the database time of the claim.
   */
  claim(limit: number, leaseMs: number): Promise<{ events: ClaimedEvent[]; now: Date }>;
  markProcessed(eventId: string, at: Date): Promise<void>;
  markRetry(eventId: string, attempts: number, availableAt: Date, errorCode: string): Promise<void>;
  markFailed(eventId: string, attempts: number, at: Date, errorCode: string): Promise<void>;
  /** Deletes events processed before `before`; returns how many. */
  purgeProcessed(before: Date): Promise<number>;
}
