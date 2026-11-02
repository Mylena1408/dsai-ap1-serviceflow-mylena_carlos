import type { PrismaClient } from "@prisma/client";
import type { NotificationType } from "../domain/recipients";
import type { EmailDeliveryLog, EmailDeliveryStore } from "../application/ports";
import { stageNamesOf } from "./prisma-notification-store";

export function createPrismaEmailStore(database: PrismaClient): EmailDeliveryStore {
  return {
    async claimPending(limit, leaseMs) {
      // Same reservation as the outbox: lock due rows (skipping rows another run holds) and push
      // their availableAt forward, so they stay reserved after commit.
      const { ids, now } = await database.$transaction(async (transaction) => {
        const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
        const rows = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "EmailDelivery"
          WHERE "status" = 'PENDING' AND "availableAt" <= ${now}
          ORDER BY "createdAt", "id"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;
        const ids = rows.map(({ id }) => id);

        if (ids.length > 0) {
          await transaction.emailDelivery.updateMany({
            where: { id: { in: ids } },
            data: { availableAt: new Date(now.getTime() + leaseMs) },
          });
        }
        return { ids, now };
      });

      if (ids.length === 0) {
        return { deliveries: [], now };
      }

      const rows = await database.emailDelivery.findMany({
        where: { id: { in: ids } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          attempts: true,
          availableAt: true,
          sentAt: true,
          lastErrorCode: true,
          recipient: { select: { email: true, isActive: true, role: true } },
          notification: {
            select: {
              type: true,
              requestId: true,
              request: { select: { serviceNameSnapshot: true } },
              event: { select: { payload: true } },
            },
          },
        },
      });
      const stageNames = await stageNamesOf(database, rows.map(({ notification }) => notification));

      return {
        now,
        deliveries: rows.map(({ notification, ...delivery }, index) => ({
          ...delivery,
          notification: {
            type: notification.type as NotificationType,
            requestId: notification.requestId,
            serviceName: notification.request.serviceNameSnapshot,
            ...(stageNames[index] ? { stageName: stageNames[index] } : {}),
          },
        })),
      };
    },
    async save(deliveryId, state) {
      await database.emailDelivery.update({
        where: { id: deliveryId },
        data: {
          status: state.status,
          attempts: state.attempts,
          availableAt: state.availableAt,
          sentAt: state.sentAt,
          lastErrorCode: state.lastErrorCode,
        },
      });
    },
  };
}

export function createPrismaEmailLog(database: PrismaClient): EmailDeliveryLog {
  return {
    async listRecent(limit) {
      const rows = await database.emailDelivery.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
          id: true,
          status: true,
          attempts: true,
          createdAt: true,
          sentAt: true,
          lastErrorCode: true,
          recipient: { select: { name: true, email: true } },
          notification: { select: { type: true } },
        },
      });
      return rows.map(({ recipient, notification, ...row }) => ({
        ...row,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        type: notification.type as NotificationType,
      }));
    },
  };
}
