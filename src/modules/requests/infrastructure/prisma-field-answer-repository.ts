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
        select: { id: true, labelSnapshot: true, typeSnapshot: true, positionSnapshot: true, value: true, updatedById: true },
      });
      // The requester's answers first, then the attendance's, each in its own order
      // (SPEC 2026-11-03-campos-condicionais-atendimento, 5.6).
      rows.sort((left, right) => Number(left.updatedById !== null) - Number(right.updatedById !== null));
      return rows.map((row) => ({
        id: row.id,
        label: row.labelSnapshot,
        type: row.typeSnapshot,
        position: row.positionSnapshot,
        value: row.value,
        audience: row.updatedById === null ? ("REQUESTER" as const) : ("ATTENDANT" as const),
      }));
    },
  };
}
