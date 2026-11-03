import { API_TOKEN_SCOPE_LABELS } from "@/modules/api-tokens";
import type { NotificationType } from "@/shared/notifications";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PersonalDataReader } from "../application/ports";
import { planAuditEntry } from "../domain/audit";

// "Meus dados" read from the database (SPEC 2026-11-02-auditoria-lgpd, 5.4). Each query selects
// only what the file shows: no password hash, and no internal note written by someone else.

const RECENT_NOTIFICATIONS = 200;

export function createPrismaPersonalDataReader(database: PrismaClient): PersonalDataReader {
  return {
    async load(userId) {
      const person = await database.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          sector: { select: { name: true } },
        },
      });

      if (!person) {
        return null;
      }

      const [preferences, requests, writtenElsewhere, notifications, permissions, apiTokens] = await Promise.all([
        database.notificationPreference.findMany({
          where: { userId, emailEnabled: true },
          select: { category: true },
          orderBy: { category: "asc" },
        }),
        database.request.findMany({
          where: { requesterId: userId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            serviceNameSnapshot: true,
            categoryNameSnapshot: true,
            sectorNameSnapshot: true,
            description: true,
            status: true,
            priority: true,
            approvalState: true,
            createdAt: true,
            completedAt: true,
            cancelledAt: true,
            dueAt: true,
            fieldValues: { orderBy: { positionSnapshot: "asc" }, select: { labelSnapshot: true, value: true } },
            events: {
              orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
              select: { occurredAt: true, toStatus: true, note: true, actor: { select: { name: true } } },
            },
            comments: {
              where: { isInternal: false },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { createdAt: true, body: true, isInternal: true, author: { select: { name: true } } },
            },
            attachments: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { requirementNameSnapshot: true, originalFilename: true, createdAt: true, removedAt: true },
            },
          },
        }),
        database.requestComment.findMany({
          where: { authorId: userId, request: { requesterId: { not: userId } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            requestId: true,
            createdAt: true,
            body: true,
            isInternal: true,
            request: { select: { serviceNameSnapshot: true } },
          },
        }),
        database.requestNotification.findMany({
          where: { recipientId: userId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: RECENT_NOTIFICATIONS,
          select: { createdAt: true, readAt: true, type: true, request: { select: { serviceNameSnapshot: true } } },
        }),
        database.userPermission.findMany({
          where: { userId },
          orderBy: { grantedAt: "asc" },
          select: { permission: true, grantedAt: true },
        }),
        // Never the value or the hash (SPEC 2026-11-02-api-externa-webhooks, 5.7).
        database.apiToken.findMany({
          where: { userId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { name: true, scope: true, lastFour: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
        }),
      ]);

      return {
        person: {
          name: person.name,
          email: person.email,
          role: person.role,
          sectorName: person.sector?.name ?? null,
          isActive: person.isActive,
          createdAt: person.createdAt,
          updatedAt: person.updatedAt,
        },
        emailCategories: preferences.map((preference) => preference.category),
        requests: requests.map((request) => ({
          id: request.id,
          serviceName: request.serviceNameSnapshot,
          categoryName: request.categoryNameSnapshot,
          sectorName: request.sectorNameSnapshot,
          description: request.description,
          status: request.status,
          priority: request.priority,
          approvalState: request.approvalState,
          createdAt: request.createdAt,
          completedAt: request.completedAt,
          cancelledAt: request.cancelledAt,
          dueAt: request.dueAt,
          answers: request.fieldValues.map((answer) => ({ label: answer.labelSnapshot, value: answer.value })),
          history: request.events.map((event) => ({
            occurredAt: event.occurredAt,
            toStatus: event.toStatus,
            actorName: event.actor.name,
            note: event.note,
          })),
          comments: request.comments.map((comment) => ({
            createdAt: comment.createdAt,
            authorName: comment.author.name,
            body: comment.body,
            isInternal: comment.isInternal,
          })),
          attachments: request.attachments.map((attachment) => ({
            requirementName: attachment.requirementNameSnapshot,
            filename: attachment.originalFilename,
            createdAt: attachment.createdAt,
            removed: attachment.removedAt !== null,
          })),
        })),
        writtenElsewhere: writtenElsewhere.map((comment) => ({
          requestId: comment.requestId,
          serviceName: comment.request.serviceNameSnapshot,
          createdAt: comment.createdAt,
          body: comment.body,
          isInternal: comment.isInternal,
        })),
        notifications: notifications.map((notification) => ({
          createdAt: notification.createdAt,
          readAt: notification.readAt,
          type: notification.type as NotificationType,
          serviceName: notification.request.serviceNameSnapshot,
        })),
        permissions,
        apiTokens: apiTokens.map((token) => ({ ...token, scope: API_TOKEN_SCOPE_LABELS[token.scope] })),
      };
    },

    async recordExport(actor) {
      const person = await database.user.findUnique({ where: { id: actor.id }, select: { name: true } });
      const entry = planAuditEntry(
        { actor, action: "EXPORTED", entityType: "USER", entityId: actor.id, entityLabel: person?.name ?? "" },
        null,
        {},
      );

      if (entry) {
        await database.auditEntry.create({ data: { ...entry, changes: entry.changes as unknown as Prisma.InputJsonValue } });
      }
    },
  };
}
