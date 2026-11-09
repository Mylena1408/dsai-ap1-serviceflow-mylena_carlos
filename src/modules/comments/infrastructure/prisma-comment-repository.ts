import type { Prisma, PrismaClient } from "@prisma/client";
import { recordOutboxEvent } from "@/modules/events";
import { resumeSlaOnRequesterReply } from "@/modules/requests";
import { autoFollowsOnComment } from "@/modules/followers";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type {
  CommentRecord,
  CommentRepository,
  CommentScopeReader,
  CommentTransactionRunner,
} from "../application/ports";

const commentWithAuthor = {
  author: { select: { id: true, name: true, role: true } },
  // SPEC 2026-11-03-anexos-comentarios-documentos, 5.1.
  files: {
    select: { id: true, originalFilename: true, detectedFormat: true, sizeBytes: true, removedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.RequestCommentInclude;

const toDomain = (
  row: Prisma.RequestCommentGetPayload<{ include: typeof commentWithAuthor }>,
): CommentRecord => ({
  id: row.id,
  requestId: row.requestId,
  body: row.body,
  isInternal: row.isInternal,
  createdAt: row.createdAt,
  author: row.author,
  files: row.files.map(({ removedAt, ...file }) => ({ ...file, removed: removedAt !== null })),
});

// The request scope is read here, like requests reads document requirements, so the module
// does not need an unauthenticated entry point in requests.
function scopeReader(client: PrismaClient | Prisma.TransactionClient): CommentScopeReader {
  return {
    findReader(userId) {
      return client.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true, sectorId: true },
      });
    },
    findRequestScope(requestId) {
      return client.request.findUnique({
        where: { id: requestId },
        select: { requesterId: true, sectorId: true, status: true },
      });
    },
  };
}

export function createPrismaCommentRepository(database: PrismaClient): CommentRepository {
  return {
    ...scopeReader(database),
    async listForRequest(requestId, includeInternal) {
      const rows = await database.requestComment.findMany({
        where: { requestId, ...(includeInternal ? {} : { isInternal: false }) },
        include: commentWithAuthor,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
    async countForRequests(requestIds, includeInternal) {
      if (requestIds.length === 0) return new Map();
      const groups = await database.requestComment.groupBy({
        by: ["requestId"],
        where: { requestId: { in: requestIds }, ...(includeInternal ? {} : { isInternal: false }) },
        _count: { _all: true },
      });
      return new Map(groups.map((group) => [group.requestId, group._count._all]));
    },
    async findFile(requestId, commentId, fileId) {
      const row = await database.requestCommentFile.findFirst({
        where: { id: fileId, commentId, requestId },
        select: { storageKey: true, originalFilename: true, contentType: true, removedAt: true, comment: { select: { isInternal: true } } },
      });
      return (
        row && {
          storageKey: row.storageKey,
          originalFilename: row.originalFilename,
          contentType: row.contentType,
          isInternal: row.comment.isInternal,
          removed: row.removedAt !== null,
        }
      );
    },
  };
}

export function createPrismaCommentTransactionRunner(database: PrismaClient): CommentTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) =>
          work({
            ...scopeReader(transaction),
            async currentTime() {
              const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
              return row.now;
            },
            recordEvent(event) {
              return recordOutboxEvent(transaction, event);
            },
            async insertComment(comment) {
              return toDomain(
                await transaction.requestComment.create({ data: comment, include: commentWithAuthor }),
              );
            },
            countFiles(requestId) {
              return transaction.requestCommentFile.count({ where: { requestId } });
            },
            async insertFiles(files) {
              await transaction.requestCommentFile.createMany({ data: files });
            },
            resumeSlaOnRequesterReply(requestId, authorId) {
              return resumeSlaOnRequesterReply(transaction, requestId, authorId);
            },
            // SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2 (decision J7).
            async followOnComment(requestId, authorId, at) {
              const [preference, following] = await Promise.all([
                transaction.followPreference.findUnique({ where: { userId: authorId }, select: { autoFollowOnComment: true } }),
                transaction.requestFollower.count({ where: { requestId, userId: authorId } }),
              ]);
              if (following > 0 || !autoFollowsOnComment(preference)) return;
              await transaction.requestFollower.create({ data: { requestId, userId: authorId, addedById: authorId, createdAt: at } });
              await transaction.requestFollowerEvent.create({ data: { requestId, userId: authorId, action: "ADDED", actorId: authorId, occurredAt: at } });
            },
          }),
        { translate: ["P2003", "P2034"], fallbackMessage: "Comment creation failed." },
      );
    },
  };
}
