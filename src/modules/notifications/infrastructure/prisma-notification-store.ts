import type { Prisma, PrismaClient } from "@prisma/client";
import { sectorSubstituteIds } from "@/modules/requests";
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

function escalationIdOf({ type, event }: StageSource): string | null {
  const id = type === "sla.escalated" ? (event?.payload as { escalationId?: unknown } | null)?.escalationId : null;
  return typeof id === "string" ? id : null;
}

/**
 * Rule applied by each rule's "sla.escalated" notification, from the escalation named by its event
 * (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 4). The option's warning has none.
 */
export async function ruleNamesOf(database: PrismaClient, rows: StageSource[]): Promise<Array<string | undefined>> {
  const ids = rows.map(escalationIdOf);
  const wanted = ids.filter((id): id is string => id !== null);
  const names = new Map(
    wanted.length === 0
      ? []
      : (await database.requestEscalation.findMany({ where: { id: { in: wanted } }, select: { id: true, ruleName: true } })).map(
          ({ id, ruleName }) => [id, ruleName ?? undefined],
        ),
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
          approvalSectorIdsSnapshot: true,
          assignee: { select: { id: true, role: true, isActive: true, sectorId: true } },
        },
      });
    },
    async escalatedAt(requestId, occurredAt) {
      // SPEC 2026-11-06-escalonamento, 4.5: the escalation is written with the breach's instant. Only
      // the option's: a rule applied in the same run has its own warning (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3).
      return (await database.requestEscalation.count({ where: { requestId, occurredAt, trigger: "OVERDUE" } })) > 0;
    },
    async escalationRecipientIds(escalationId) {
      const row = await database.requestEscalation.findUnique({ where: { id: escalationId }, select: { notifiedUserIds: true } });
      return row?.notifiedUserIds ?? [];
    },
    async approvalDeciderIds(sectorId) {
      const managers = await database.user.findMany({
        where: { sectorId, role: "MANAGER", isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const substitutes = await sectorSubstituteIds(database, sectorId);
      return [...new Set([...managers.map(({ id }) => id), ...substitutes])];
    },
    async sectorManagerIds(sectorId) {
      const rows = await database.user.findMany({
        where: { sectorId, role: "MANAGER", isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      return rows.map(({ id }) => id);
    },
    // SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 item 3.
    async followers(requestId, sectorId) {
      const rows = await database.requestFollower.findMany({
        where: { requestId, user: { isActive: true } },
        select: { userId: true, user: { select: { role: true, sectorId: true } } },
        orderBy: { userId: "asc" },
      });
      return {
        colleagueIds: rows.filter(({ user }) => user.role === "REQUESTER").map(({ userId }) => userId),
        attendantIds: rows.filter(({ user }) => user.role === "ATTENDANT" && user.sectorId === sectorId).map(({ userId }) => userId),
      };
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
      const [stageNames, ruleNames] = await Promise.all([stageNamesOf(database, rows), ruleNamesOf(database, rows)]);
      return rows.map((row, index) => {
        const stageName = stageNames[index];
        const ruleName = ruleNames[index];
        return {
          id: row.id,
          requestId: row.requestId,
          type: row.type as NotificationType,
          createdAt: row.createdAt,
          readAt: row.readAt,
          serviceName: row.request.serviceNameSnapshot,
          ...(stageName ? { stageName } : {}),
          ...(ruleName ? { ruleName } : {}),
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
