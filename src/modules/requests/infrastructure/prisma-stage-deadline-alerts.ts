import type { PrismaClient } from "@prisma/client";
import { recordOutboxEvent } from "@/modules/events";
import type { StageDeadlineStore } from "../application/stage-deadline-alerts";

// Persistence of the late stage announcements (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 5.3.2). The mark and the event go together; the conditions repeat what was read, so two runs at
// the same time announce a stage entry once.

export function createPrismaStageDeadlineStore(database: PrismaClient): StageDeadlineStore {
  return {
    findCandidates(now, limit) {
      return database.request.findMany({
        where: { status: "IN_PROGRESS", stageDueAt: { lte: now }, stageOverdueNotifiedAt: null },
        select: { id: true, status: true, stageIndex: true, stageDueAt: true },
        orderBy: [{ stageDueAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },
    markAndRecord(candidate, stageIndex, now) {
      return database.$transaction(async (transaction) => {
        const changed = await transaction.request.updateMany({
          where: {
            id: candidate.id,
            status: "IN_PROGRESS",
            stageIndex: candidate.stageIndex,
            stageDueAt: candidate.stageDueAt,
            stageOverdueNotifiedAt: null,
          },
          data: { stageOverdueNotifiedAt: now },
        });

        if (changed.count !== 1) {
          return false;
        }

        await recordOutboxEvent(transaction, {
          type: "request.stage_overdue",
          requestId: candidate.id,
          occurredAt: now,
          payload: { stageIndex },
        });
        return true;
      });
    },
  };
}
