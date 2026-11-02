import type { Prisma, PrismaClient } from "@prisma/client";
import type { NotificationCategory } from "../domain/email";
import type { NotificationType } from "../domain/recipients";
import type { NotificationStore } from "../application/ports";

type StageSource = { type: string; event: { payload: Prisma.JsonValue } | null };

function stageEventIdOf({ type, event }: StageSource): string | null {
  const id = type === "stage.changed" ? (event?.payload as { stageEventId?: unknown } | null)?.stageEventId : null;
  return typeof id === "string" ? id : null;
}

/**
 * Stage entered by each "stage.changed" notification, from the history row named by its event
 * (identifiers only in the outbox; SPEC de fluxos, 5.5). Missing once the event is purged.
 */
export async function stageNamesOf(database: PrismaClient, rows: StageSource[]): Promise<Array<string | undefined>> {
  const ids = rows.map(stageEventIdOf);
  const wanted = ids.filter((id): id is string => id !== null);
  const names = new Map(
    wanted.length === 0
      ? []
      : (
          await database.requestStageEvent.findMany({ where: { id: { in: wanted } }, select: { id: true, toStage: true } })
        ).map(({ id, toStage }) => [id, toStage]),
  );
  return ids.map((id) => (id ? names.get(id) : undefined));
}

export function createPrismaNotificationStore(database: PrismaClient): NotificationStore {
  return {
    findRequestState(requestId) {
      return database.request.findUnique({
        where: { id: requestId },
        select: {
          requesterId: true,
          sectorId: true,
          status: true,
          approvalState: true,
          assignee: { select: { id: true, role: true, isActive: true, sectorId: true } },
        },
      });
    },
    async sectorManagerIds(sectorId) {
      const rows = await database.user.findMany({
        where: { sectorId, role: "MANAGER", isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      return rows.map(({ id }) => id);
    },
    async sectorAttendantIds(sectorId) {
      const rows = await database.user.findMany({
        where: { sectorId, role: "ATTENDANT", isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      return rows.map(({ id }) => id);
    },
    async activeUserIds(userIds) {
      const rows = await database.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true },
      });
      return new Set(rows.map(({ id }) => id));
    },
    async emailCategories(userIds) {
      const rows = await database.notificationPreference.findMany({
        where: { userId: { in: userIds }, emailEnabled: true },
        select: { userId: true, category: true },
      });
      const categories = new Map<string, Set<NotificationCategory>>();
      for (const { userId, category } of rows) {
        categories.set(userId, (categories.get(userId) ?? new Set()).add(category));
      }
      return categories;
    },
    async insertMany(notifications) {
      if (notifications.length === 0) return;
      const wantEmail = new Set(
        notifications.filter(({ sendEmail }) => sendEmail).map(({ eventId, recipientId }) => `${eventId}:${recipientId}`),
      );
      await database.$transaction(async (transaction) => {
        // Only rows inserted now come back: reprocessing an event never adds an email later.
        const inserted = await transaction.requestNotification.createManyAndReturn({
          data: notifications.map(({ eventId, requestId, recipientId, type, createdAt }) => ({
            eventId,
            requestId,
            recipientId,
            type,
            createdAt,
          })),
          skipDuplicates: true,
          select: { id: true, eventId: true, recipientId: true, createdAt: true },
        });
        const deliveries = inserted
          .filter(({ eventId, recipientId }) => wantEmail.has(`${eventId}:${recipientId}`))
          .map(({ id, recipientId, createdAt }) => ({ notificationId: id, recipientId, availableAt: createdAt, createdAt }));
        if (deliveries.length > 0) {
          await transaction.emailDelivery.createMany({ data: deliveries, skipDuplicates: true });
        }
      });
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
          event: { select: { payload: true } },
        },
      });
      const stageNames = await stageNamesOf(database, rows);
      return rows.map((row, index) => {
        const stageName = stageNames[index];
        return {
          id: row.id,
          requestId: row.requestId,
          type: row.type as NotificationType,
          createdAt: row.createdAt,
          readAt: row.readAt,
          serviceName: row.request.serviceNameSnapshot,
          ...(stageName ? { stageName } : {}),
        };
      });
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
