import { Prisma, type PrismaClient } from "@prisma/client";
import type { TimeReportReader } from "../application/time-report";

// The time report in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 item 4): entries not removed whose day
// is in the period, on requests of the sector in scope (the request's current sector), summed in the database.

const sectorFilter = (sectorId: string | null) => (sectorId ? Prisma.sql`AND r."sectorId" = ${sectorId}::uuid` : Prisma.empty);

export function createPrismaTimeReportReader(database: PrismaClient): TimeReportReader {
  return {
    async sums(scope, period) {
      const rows = await database.$queryRaw<
        Array<{ userId: string; userName: string; serviceName: string; sectorId: string; sectorName: string; minutes: bigint; entries: bigint }>
      >`
        SELECT e."userId", u."name" AS "userName", r."serviceNameSnapshot" AS "serviceName",
          r."sectorId", s."name" AS "sectorName", sum(e."minutes") AS "minutes", count(*) AS "entries"
        FROM "RequestTimeEntry" e
        JOIN "Request" r ON r."id" = e."requestId"
        JOIN "User" u ON u."id" = e."userId"
        JOIN "Sector" s ON s."id" = r."sectorId"
        WHERE e."deletedAt" IS NULL
          AND e."workedOn" BETWEEN ${period.firstDay}::date AND ${period.lastDay}::date
          ${sectorFilter(scope.sectorId)}
        GROUP BY e."userId", u."name", r."serviceNameSnapshot", r."sectorId", s."name"
      `;
      return rows.map((row) => ({ ...row, minutes: Number(row.minutes), entries: Number(row.entries) }));
    },
    async entries(scope, period, limit) {
      const rows = await database.$queryRaw<
        Array<{ workedOn: string; userName: string; sectorName: string; serviceName: string; requestId: string; minutes: number }>
      >`
        SELECT to_char(e."workedOn", 'YYYY-MM-DD') AS "workedOn", u."name" AS "userName", s."name" AS "sectorName",
          r."serviceNameSnapshot" AS "serviceName", r."id" AS "requestId", e."minutes"
        FROM "RequestTimeEntry" e
        JOIN "Request" r ON r."id" = e."requestId"
        JOIN "User" u ON u."id" = e."userId"
        JOIN "Sector" s ON s."id" = r."sectorId"
        WHERE e."deletedAt" IS NULL
          AND e."workedOn" BETWEEN ${period.firstDay}::date AND ${period.lastDay}::date
          ${sectorFilter(scope.sectorId)}
        ORDER BY e."workedOn", u."name", e."createdAt", e."id"
        LIMIT ${limit}
      `;
      return rows;
    },
  };
}
