import type { PrismaClient } from "@prisma/client";
import type { MyMentionsReader } from "../application/my-mentions";

// "Minhas menções" in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1): only the person's mentions on
// requests of their current sector; "seen" is written once.

const ofSector = (userId: string, sectorId: string) => ({ userId, comment: { request: { sectorId } } });

export function createPrismaMyMentionsReader(database: PrismaClient): MyMentionsReader {
  return {
    async list(userId, sectorId, limit) {
      const rows = await database.commentMention.findMany({
        where: ofSector(userId, sectorId),
        orderBy: [{ createdAt: "desc" }, { commentId: "asc" }],
        take: limit,
        select: {
          commentId: true,
          createdAt: true,
          seenAt: true,
          comment: { select: { requestId: true, author: { select: { name: true } }, request: { select: { serviceNameSnapshot: true } } } },
        },
      });
      return rows.map((row) => ({
        commentId: row.commentId,
        requestId: row.comment.requestId,
        serviceName: row.comment.request.serviceNameSnapshot,
        authorName: row.comment.author.name,
        createdAt: row.createdAt,
        seenAt: row.seenAt,
      }));
    },
    countUnseen(userId, sectorId) {
      return database.commentMention.count({ where: { ...ofSector(userId, sectorId), seenAt: null } });
    },
    async markSeen(commentId, userId, sectorId, at) {
      const mention = await database.commentMention.findFirst({
        where: { commentId, ...ofSector(userId, sectorId) },
        select: { seenAt: true, comment: { select: { requestId: true } } },
      });
      if (!mention) return null;
      if (mention.seenAt === null) {
        await database.commentMention.updateMany({ where: { commentId, userId, seenAt: null }, data: { seenAt: at } });
      }
      return mention.comment.requestId;
    },
  };
}
