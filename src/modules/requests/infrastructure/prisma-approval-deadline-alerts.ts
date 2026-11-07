import type { PrismaClient } from "@prisma/client";
import { recordOutboxEvent } from "@/modules/events";
import type { ApprovalDeadlineStore } from "../application/approval-deadline-alerts";

// Persistence of the late approval announcements (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 4.3.6). The mark and the event go together; the conditions repeat what was read, so two runs at
// the same time announce a level once.

export function createPrismaApprovalDeadlineStore(database: PrismaClient): ApprovalDeadlineStore {
  return {
    findCandidates(now, limit) {
      return database.request.findMany({
        where: { status: "OPEN", approvalState: "PENDING", approvalDueAt: { lte: now }, approvalOverdueNotifiedAt: null },
        select: {
          id: true,
          sectorId: true,
          approvalState: true,
          approvalLevel: true,
          approvalPendingSectorId: true,
          approvalDueAt: true,
        },
        orderBy: [{ approvalDueAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },
    markAndRecord(candidate, alert, now) {
      return database.$transaction(async (transaction) => {
        const changed = await transaction.request.updateMany({
          where: {
            id: candidate.id,
            status: "OPEN",
            approvalState: "PENDING",
            approvalLevel: candidate.approvalLevel,
            approvalDueAt: candidate.approvalDueAt,
            approvalOverdueNotifiedAt: null,
          },
          data: { approvalOverdueNotifiedAt: now },
        });

        if (changed.count !== 1) {
          return false;
        }

        await recordOutboxEvent(transaction, {
          type: "request.approval_overdue",
          requestId: candidate.id,
          occurredAt: now,
          payload: alert,
        });
        return true;
      });
    },
  };
}
