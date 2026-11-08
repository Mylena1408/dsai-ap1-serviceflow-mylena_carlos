import { Prisma, type PrismaClient } from "@prisma/client";
import { organizationToday } from "@/server/authorization/effective-permissions";
import type { SectorLoad, TeamLoadReader } from "../application/team-load";

// The team's load in one query per screen (SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8), by the
// index on the requests' assignee and status.

interface Row {
  sectorId: string;
  sectorName: string;
  mode: SectorLoad["mode"];
  maxActivePerAttendant: number | null;
  unassigned: number;
  memberId: string | null;
  memberName: string | null;
  activeRequests: number | null;
  absentToday: boolean | null;
}

export function createPrismaTeamLoadReader(database: PrismaClient): TeamLoadReader {
  return {
    async loads(sectorId) {
      const today = await organizationToday(database);
      const rows = await database.$queryRaw<Row[]>`
        SELECT s."id"::text AS "sectorId", s."name" AS "sectorName", s."distributionMode"::text AS "mode", s."maxActivePerAttendant",
          (SELECT count(*)::int FROM "Request" q WHERE q."sectorId" = s."id" AND q."status" = 'OPEN' AND q."assigneeId" IS NULL) AS "unassigned",
          u."id"::text AS "memberId", u."name" AS "memberName",
          (SELECT count(*)::int FROM "Request" r WHERE r."assigneeId" = u."id" AND r."status" IN ('OPEN', 'IN_PROGRESS')) AS "activeRequests",
          EXISTS (
            SELECT 1 FROM "AttendantAbsence" a
            WHERE a."userId" = u."id" AND a."cancelledAt" IS NULL AND a."startsOn" <= ${today}::date AND a."endsOn" >= ${today}::date
          ) AS "absentToday"
        FROM "Sector" s
        LEFT JOIN "User" u ON u."sectorId" = s."id" AND u."role" = 'ATTENDANT' AND u."isActive"
        WHERE s."isActive" ${sectorId === null ? Prisma.empty : Prisma.sql`AND s."id" = ${sectorId}::uuid`}
        ORDER BY s."name", s."id", u."name", u."id"`;

      const bySector = new Map<string, SectorLoad>();
      for (const row of rows) {
        const load =
          bySector.get(row.sectorId) ??
          bySector
            .set(row.sectorId, {
              sectorId: row.sectorId,
              sectorName: row.sectorName,
              mode: row.mode,
              maxActivePerAttendant: row.maxActivePerAttendant,
              unassigned: row.unassigned,
              members: [],
            })
            .get(row.sectorId)!;
        if (row.memberId && row.memberName !== null) {
          load.members.push({ id: row.memberId, name: row.memberName, activeRequests: row.activeRequests ?? 0, absentToday: row.absentToday ?? false });
        }
      }
      return [...bySector.values()];
    },
  };
}
