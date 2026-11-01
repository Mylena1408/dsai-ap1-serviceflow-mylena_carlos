import type { Prisma, PrismaClient } from "@prisma/client";
import type { ClaimedEvent, OutboxStore } from "../application/ports";
import { outboxPayload, type DomainEvent, type DomainEventType } from "../domain/domain-event";

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

type ClaimRow = {
  id: string;
  type: DomainEventType;
  requestId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
};

export function createPrismaOutboxStore(database: PrismaClient): OutboxStore {
  return {
    claim(limit, leaseMs) {
      // A short transaction locks the available rows (skipping rows another processor
      // holds) and pushes their availableAt forward, so they stay reserved after commit.
      return database.$transaction(async (transaction) => {
        const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
        const rows = await transaction.$queryRaw<ClaimRow[]>`
          SELECT "id", "type", "requestId", "payload", "occurredAt", "attempts"
          FROM "OutboxEvent"
          WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "availableAt" <= ${now}
          ORDER BY "occurredAt", "id"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length > 0) {
          await transaction.outboxEvent.updateMany({
            where: { id: { in: rows.map(({ id }) => id) } },
            data: { availableAt: new Date(now.getTime() + leaseMs) },
          });
        }

        const events: ClaimedEvent[] = rows.map((row) => ({ ...row }));
        return { events, now };
      });
    },
    async markProcessed(eventId, at) {
      await database.outboxEvent.update({ where: { id: eventId }, data: { processedAt: at } });
    },
    async markRetry(eventId, attempts, availableAt, errorCode) {
      await database.outboxEvent.update({
        where: { id: eventId },
        data: { attempts, availableAt, lastErrorCode: errorCode },
      });
    },
    async markFailed(eventId, attempts, at, errorCode) {
      await database.outboxEvent.update({
        where: { id: eventId },
        data: { attempts, failedAt: at, lastErrorCode: errorCode },
      });
    },
    async purgeProcessed(before) {
      const result = await database.outboxEvent.deleteMany({ where: { processedAt: { lt: before } } });
      return result.count;
    },
  };
}
