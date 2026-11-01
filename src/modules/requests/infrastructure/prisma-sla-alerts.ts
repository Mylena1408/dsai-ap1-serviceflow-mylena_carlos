import type { PrismaClient } from "@prisma/client";
import { recordOutboxEvent } from "@/modules/events";
import type { SlaAlertStore } from "../application/sla-alerts";
import type { RequestStatus } from "../domain/request";

const ACTIVE_STATUSES: RequestStatus[] = ["OPEN", "IN_PROGRESS"];

export function createPrismaSlaAlertStore(database: PrismaClient): SlaAlertStore {
  return {
    findCandidates(now, limit) {
      return database.request.findMany({
        where: {
          status: { in: ACTIVE_STATUSES },
          // dueSoonAt is kept by a database trigger (migration 20261101200000).
          dueSoonAt: { lte: now },
          OR: [{ slaWarningNotifiedAt: null }, { slaBreachNotifiedAt: null, dueAt: { lt: now } }],
        },
        select: {
          id: true,
          status: true,
          priority: true,
          slaHoursSnapshot: true,
          dueAt: true,
          completedLate: true,
          slaWarningNotifiedAt: true,
          slaBreachNotifiedAt: true,
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },
    markAndRecord(candidate, kind, now) {
      return database.$transaction(async (transaction) => {
        const changed = await transaction.request.updateMany({
          where: {
            id: candidate.id,
            status: { in: ACTIVE_STATUSES },
            dueAt: candidate.dueAt,
            slaWarningNotifiedAt: candidate.slaWarningNotifiedAt,
            slaBreachNotifiedAt: null,
          },
          // A breach also closes the warning, so a late "due soon" is never sent.
          data:
            kind === "breach"
              ? { slaBreachNotifiedAt: now, slaWarningNotifiedAt: candidate.slaWarningNotifiedAt ?? now }
              : { slaWarningNotifiedAt: now },
        });

        if (changed.count !== 1) {
          return false;
        }

        await recordOutboxEvent(transaction, {
          type: kind === "breach" ? "request.sla_breached" : "request.sla_warning",
          requestId: candidate.id,
          occurredAt: now,
          payload: {},
        });
        return true;
      });
    },
  };
}
