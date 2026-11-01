import type { PrismaClient } from "@prisma/client";
import type { FieldAnswerQueryRepository } from "../application/ports";

export function createPrismaFieldAnswerQueryRepository(database: PrismaClient): FieldAnswerQueryRepository {
  return {
    async findRequestScope(requestId) {
      const row = await database.request.findUnique({
        where: { id: requestId },
        select: { requesterId: true, sectorId: true, approvalState: true },
      });
      return row && { requesterId: row.requesterId, sectorId: row.sectorId, requiresApproval: row.approvalState !== null };
    },
    async listForRequest(requestId) {
      const rows = await database.requestFieldValue.findMany({
        where: { requestId },
        orderBy: [{ positionSnapshot: "asc" }, { id: "asc" }],
        select: { id: true, labelSnapshot: true, typeSnapshot: true, positionSnapshot: true, value: true },
      });
      return rows.map((row) => ({
        id: row.id,
        label: row.labelSnapshot,
        type: row.typeSnapshot,
        position: row.positionSnapshot,
        value: row.value,
      }));
    },
  };
}
