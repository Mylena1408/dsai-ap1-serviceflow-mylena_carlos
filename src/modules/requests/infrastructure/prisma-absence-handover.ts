import type { PrismaClient } from "@prisma/client";
import { organizationToday } from "@/server/authorization/effective-permissions";
import type { AbsenceHandoverStore } from "../application/absence-handover";
import type { RequestTransactionRunner } from "../application/ports";

// Absences to hand over (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7), read with the organization's day.

export function createPrismaAbsenceHandoverStore(database: PrismaClient, transactions: RequestTransactionRunner): AbsenceHandoverStore {
  return {
    transactions,
    async dueAbsences() {
      const today = await organizationToday(database);
      return database.$queryRaw<Array<{ absenceId: string; userId: string; sectorId: string }>>`
        SELECT a."id"::text AS "absenceId", a."userId"::text AS "userId", u."sectorId"::text AS "sectorId"
        FROM "AttendantAbsence" a
        JOIN "User" u ON u."id" = a."userId"
        JOIN "Sector" s ON s."id" = u."sectorId"
        WHERE a."cancelledAt" IS NULL
          AND a."redistributedAt" IS NULL
          AND a."startsOn" <= ${today}::date AND a."endsOn" >= ${today}::date
          AND u."role" = 'ATTENDANT'
          AND s."redistributeOnAbsence" AND s."distributionMode" <> 'NONE'
        ORDER BY a."startsOn", a."id"`;
    },
    async heldRequests(userId, sectorId) {
      const rows = await database.request.findMany({
        where: { assigneeId: userId, sectorId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { id: true, status: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(({ id, status }) => ({ id, status: status as "OPEN" | "IN_PROGRESS" }));
    },
    async markHandedOver(absenceId) {
      const changed = await database.attendantAbsence.updateMany({
        where: { id: absenceId, redistributedAt: null, cancelledAt: null },
        data: { redistributedAt: new Date() },
      });
      return changed.count === 1;
    },
  };
}
