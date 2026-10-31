import type { Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type {
  CommentRecord,
  CommentRepository,
  CommentScopeReader,
  CommentTransactionRunner,
} from "../application/ports";

const commentWithAuthor = {
  author: { select: { id: true, name: true, role: true } },
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
            async insertComment(comment) {
              return toDomain(
                await transaction.requestComment.create({ data: comment, include: commentWithAuthor }),
              );
            },
          }),
        { translate: ["P2003", "P2034"], fallbackMessage: "Comment creation failed." },
      );
    },
  };
}
