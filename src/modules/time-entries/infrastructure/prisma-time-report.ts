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
    // 13.2 item 1: requests completed in the period with time logged, by service; the service's current estimate.
    async estimates(scope, period) {
      const rows = await database.$queryRaw<
        Array<{ serviceId: string; serviceName: string; estimatedHours: number | null; completed: bigint; averageMinutes: number }>
      >`
        SELECT sv."id" AS "serviceId", sv."name" AS "serviceName", sv."estimatedHours",
          count(*) AS "completed", round(avg(t."minutes"))::int AS "averageMinutes"
        FROM (
          SELECT e."requestId", sum(e."minutes") AS "minutes"
          FROM "RequestTimeEntry" e
          WHERE e."deletedAt" IS NULL
          GROUP BY e."requestId"
        ) t
        JOIN "Request" r ON r."id" = t."requestId"
        JOIN "Service" sv ON sv."id" = r."serviceId"
        WHERE r."status" = 'COMPLETED'
          AND r."completedAt" >= ${period.from} AND r."completedAt" < ${period.before}
          ${sectorFilter(scope.sectorId)}
        GROUP BY sv."id", sv."name", sv."estimatedHours"
      `;
      return rows.map((row) => ({ ...row, completed: Number(row.completed) }));
    },
  };
}
