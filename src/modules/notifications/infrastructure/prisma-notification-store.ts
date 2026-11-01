import type { PrismaClient } from "@prisma/client";
import type { NotificationType } from "../domain/recipients";
import type { NotificationStore } from "../application/ports";

export function createPrismaNotificationStore(database: PrismaClient): NotificationStore {
  return {
    findRequestState(requestId) {
      return database.request.findUnique({
        where: { id: requestId },
        select: {
          requesterId: true,
          sectorId: true,
          assignee: { select: { id: true, role: true, isActive: true, sectorId: true } },
        },
      });
    },
    async activeUserIds(userIds) {
      const rows = await database.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true },
      });
      return new Set(rows.map(({ id }) => id));
    },
    async insertMany(notifications) {
      if (notifications.length === 0) return;
      await database.requestNotification.createMany({ data: notifications, skipDuplicates: true });
    },
    countUnread(recipientId) {
      return database.requestNotification.count({ where: { recipientId, readAt: null } });
    },
    async listRecent(recipientId, limit) {
      const rows = await database.requestNotification.findMany({
        where: { recipientId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
          id: true,
          requestId: true,
          type: true,
          createdAt: true,
          readAt: true,
          request: { select: { serviceNameSnapshot: true } },
        },
      });
      return rows.map(({ request, type, ...row }) => ({
        ...row,
        type: type as NotificationType,
        serviceName: request.serviceNameSnapshot,
      }));
    },
    async markAllRead(recipientId) {
      await database.requestNotification.updateMany({
        where: { recipientId, readAt: null },
        data: { readAt: new Date() },
      });
    },
    async markRead(notificationId, recipientId) {
      const notification = await database.requestNotification.findFirst({
        where: { id: notificationId, recipientId },
        select: { requestId: true, readAt: true },
      });

      if (!notification) return null;
      if (!notification.readAt) {
        await database.requestNotification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
      }
      return notification.requestId;
    },
    async purgeRead(before) {
      const result = await database.requestNotification.deleteMany({ where: { readAt: { lt: before } } });
      return result.count;
    },
  };
}
