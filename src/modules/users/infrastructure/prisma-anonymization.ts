import type { Prisma, PrismaClient, ServiceFieldType } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { createPrismaAuditScope } from "@/modules/audit";
import type { AnonymizationTransaction, AnonymizationTransactionRunner } from "../application/ports";

// Effects of the anonymization over the database (SPEC 2026-11-02-auditoria-lgpd, 5.5.3).
// Requests, history rows, dates and statuses are never deleted: only identity and texts change.

/** Removing files waits on the storage; the transaction gets more than Prisma's default 5 s. */
const ANONYMIZATION_TIMEOUT_MS = 60_000;

function createPrismaAnonymizationTransaction(transaction: Prisma.TransactionClient): AnonymizationTransaction {
  return {
    ...createPrismaAuditScope(transaction),
    async currentTime() {
      // Same database clock as the request and permission histories.
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    findTarget(userId) {
      return transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true, anonymizedAt: true },
      });
    },
    countActiveAdministrators() {
      return transaction.user.count({ where: { role: "ADMIN", isActive: true } });
    },
    countOngoingRequests(userId) {
      return transaction.request.count({
        where: {
          status: { in: ["OPEN", "IN_PROGRESS"] },
          OR: [{ requesterId: userId }, { assigneeId: userId }],
        },
      });
    },
    async replaceIdentity(userId, identity) {
      await transaction.user.update({ where: { id: userId }, data: identity });
    },
    async replaceWrittenContent(userId, replacement, textFieldTypes) {
      await transaction.request.updateMany({ where: { requesterId: userId }, data: { description: replacement } });
      await transaction.requestFieldValue.updateMany({
        where: { request: { requesterId: userId }, typeSnapshot: { in: textFieldTypes as ServiceFieldType[] } },
        data: { value: replacement },
      });
      await transaction.requestComment.updateMany({ where: { authorId: userId }, data: { body: replacement } });
      await transaction.requestApproval.updateMany({
        where: { deciderId: userId, note: { not: null } },
        data: { note: replacement },
      });
      await transaction.requestStatusEvent.updateMany({
        where: { actorId: userId, note: { not: null } },
        data: { note: replacement },
      });
      await transaction.requestStageEvent.updateMany({
        where: { actorId: userId, note: { not: null } },
        data: { note: replacement },
      });
      // SPEC 2026-11-03-transferencia-entre-setores, 5.9: the reason of a move is mandatory.
      await transaction.requestSectorEvent.updateMany({ where: { actorId: userId }, data: { note: replacement } });
    },
    async deleteNotificationData(userId) {
      await transaction.emailDelivery.deleteMany({ where: { recipientId: userId } });
      await transaction.requestNotification.deleteMany({ where: { recipientId: userId } });
      await transaction.notificationPreference.deleteMany({ where: { userId } });
    },
    async revokePermissions(userId, actorId, occurredAt) {
      const grants = await transaction.userPermission.findMany({ where: { userId }, select: { permission: true } });

      if (grants.length === 0) {
        return;
      }

      await transaction.userPermission.deleteMany({ where: { userId } });
      await transaction.userPermissionEvent.createMany({
        data: grants.map(({ permission }) => ({ userId, permission, action: "REVOKED" as const, actorId, occurredAt })),
      });
    },
    async revokeApiTokens(userId, actorId, revokedAt) {
      await transaction.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt, revokedById: actorId } });
    },
    async markAttachmentsRemoved(userId, filename, removedAt) {
      const attachments = await transaction.requestAttachment.findMany({
        where: { uploadedById: userId, removedAt: null },
        select: { storageKey: true },
        orderBy: { id: "asc" },
      });

      await transaction.requestAttachment.updateMany({
        where: { uploadedById: userId, removedAt: null },
        data: { removedAt, originalFilename: filename },
      });
      // SPEC 2026-11-03-anexos-comentarios-documentos, 5.4: the files of the person's comments too.
      const commentFiles = await transaction.requestCommentFile.findMany({
        where: { uploadedById: userId, removedAt: null },
        select: { storageKey: true },
        orderBy: { id: "asc" },
      });
      await transaction.requestCommentFile.updateMany({
        where: { uploadedById: userId, removedAt: null },
        data: { removedAt, originalFilename: filename },
      });

      return [...attachments, ...commentFiles].map(({ storageKey }) => storageKey);
    },
    async relabelAuditEntries(userId, label) {
      await transaction.auditEntry.updateMany({ where: { entityType: "USER", entityId: userId }, data: { entityLabel: label } });
    },
  };
}

export function createPrismaAnonymizationTransactionRunner(database: PrismaClient): AnonymizationTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaAnonymizationTransaction(transaction)),
        { translate: ["P2002", "P2025", "P2003"], fallbackMessage: "User anonymization failed." },
        { timeoutMs: ANONYMIZATION_TIMEOUT_MS },
      );
    },
  };
}
