import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import type { DomainEventType } from "@/modules/events";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type {
  WebhookDeliveryStore,
  WebhookReader,
  WebhookRecord,
  WebhookTransaction,
  WebhookTransactionRunner,
} from "../application/ports";

// Persistence of the webhooks (SPEC 2026-11-02-api-externa-webhooks, 5.6 and 6).

const recordSelect = {
  id: true,
  name: true,
  url: true,
  eventTypes: true,
  sectorIds: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebhookEndpointSelect;

function toRecord(row: Prisma.WebhookEndpointGetPayload<{ select: typeof recordSelect }>): WebhookRecord {
  return { ...row, eventTypes: row.eventTypes as DomainEventType[] };
}

function createPrismaWebhookTransaction(transaction: Prisma.TransactionClient): WebhookTransaction {
  return {
    ...createPrismaAuditScope(transaction),
    async currentTime() {
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row!.now;
    },
    countActive() {
      return transaction.webhookEndpoint.count({ where: { isActive: true } });
    },
    insert(webhook) {
      return transaction.webhookEndpoint.create({ data: webhook, select: { id: true } });
    },
    async find(webhookId) {
      const row = await transaction.webhookEndpoint.findUnique({ where: { id: webhookId }, select: recordSelect });
      return row && toRecord(row);
    },
    update(webhookId, changes) {
      return transaction.webhookEndpoint.update({ where: { id: webhookId }, data: changes, select: { id: true } });
    },
    async existingSectorIds() {
      return (await transaction.sector.findMany({ select: { id: true } })).map(({ id }) => id);
    },
    findDelivery(deliveryId) {
      return transaction.webhookDelivery.findUnique({
        where: { id: deliveryId },
        select: { id: true, status: true, endpoint: { select: { isActive: true } } },
      });
    },
    async requeueDelivery(deliveryId, at) {
      await transaction.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: "PENDING", attempts: 0, availableAt: at, lastErrorCode: null, deliveredAt: null },
      });
    },
    async cancelPending(webhookId) {
      const result = await transaction.webhookDelivery.updateMany({
        where: { endpointId: webhookId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      return result.count;
    },
  };
}

export function createPrismaWebhookTransactionRunner(database: PrismaClient): WebhookTransactionRunner {
  return {
    run: (work) =>
      runSerializableTransaction(database, (transaction) => work(createPrismaWebhookTransaction(transaction)), {
        translate: ["P2002", "P2025", "P2034"],
        fallbackMessage: "Webhook operation failed.",
      }),
  };
}

export function createPrismaWebhookReader(database: PrismaClient): WebhookReader {
  return {
    async list() {
      const rows = await database.webhookEndpoint.findMany({
        select: recordSelect,
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toRecord);
    },
    async recentDeliveries(limit) {
      const rows = await database.webhookDelivery.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
          id: true,
          eventType: true,
          status: true,
          attempts: true,
          lastErrorCode: true,
          createdAt: true,
          deliveredAt: true,
          endpoint: { select: { name: true, isActive: true } },
        },
      });
      return rows.map(({ endpoint, ...row }) => ({ ...row, webhookName: endpoint.name, webhookActive: endpoint.isActive }));
    },
    sectors() {
      return database.sector.findMany({ select: { id: true, name: true, isActive: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
    },
  };
}

export function createPrismaWebhookDeliveryStore(database: PrismaClient): WebhookDeliveryStore {
  return {
    subscribers(eventType) {
      return database.webhookEndpoint.findMany({
        where: { isActive: true, eventTypes: { has: eventType } },
        select: { id: true, sectorIds: true },
      });
    },
    async requestSector(requestId) {
      return (await database.request.findUnique({ where: { id: requestId }, select: { sectorId: true } }))?.sectorId ?? null;
    },
    async register(deliveries) {
      await database.webhookDelivery.createMany({
        data: deliveries.map(({ endpointId, eventId, eventType, body, at }) => ({
          endpointId,
          eventId,
          eventType,
          // Kept as text inside JSON so the signed bytes are exactly the ones sent (5.6).
          body: body as unknown as Prisma.InputJsonValue,
          availableAt: at,
          createdAt: at,
        })),
        skipDuplicates: true,
      });
    },
    async claimPending(limit, leaseMs) {
      // Same reservation as the outbox and the emails: lock due rows, skipping rows another run
      // holds, and push their availableAt forward so they stay reserved after commit.
      const { ids, now } = await database.$transaction(async (transaction) => {
        const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "WebhookDelivery"
          WHERE "status" = 'PENDING' AND "availableAt" <= ${now}
          ORDER BY "createdAt", "id"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;
        const ids = rows.map(({ id }) => id);
        if (ids.length > 0) {
          await transaction.webhookDelivery.updateMany({
            where: { id: { in: ids } },
            data: { availableAt: new Date(now.getTime() + leaseMs) },
          });
        }
        return { ids, now };
      });

      if (ids.length === 0) return { deliveries: [], now };

      const rows = await database.webhookDelivery.findMany({
        where: { id: { in: ids } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          eventType: true,
          body: true,
          attempts: true,
          endpoint: { select: { id: true, url: true, isActive: true, encryptedSecret: true } },
        },
      });
      return { deliveries: rows.map((row) => ({ ...row, body: row.body as unknown as string })), now };
    },
    async save(deliveryId, update) {
      await database.webhookDelivery.update({
        where: { id: deliveryId },
        data:
          update.status === "DELIVERED"
            ? { status: "DELIVERED", attempts: update.attempts, deliveredAt: update.deliveredAt, lastErrorCode: null }
            : update.status === "PENDING"
              ? { status: "PENDING", attempts: update.attempts, availableAt: update.availableAt, lastErrorCode: update.lastErrorCode }
              : update.status === "FAILED"
                ? { status: "FAILED", attempts: update.attempts, lastErrorCode: update.lastErrorCode }
                : { status: "CANCELLED" },
      });
    },
  };
}

/** Deliveries finished (delivered, failed or cancelled) before `before` (retention, 5.7). */
export async function purgeWebhookDeliveries(database: PrismaClient, before: Date): Promise<number> {
  const result = await database.webhookDelivery.deleteMany({
    where: { status: { in: ["DELIVERED", "FAILED", "CANCELLED"] }, createdAt: { lt: before } },
  });
  return result.count;
}
