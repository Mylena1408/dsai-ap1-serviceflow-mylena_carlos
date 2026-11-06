import { Prisma, type PrismaClient, type RequestPriority, type RequestStatus } from "@prisma/client";
import type { DailyCounts, DurationAggregate, StageTimeRow, TeamMemberRow } from "../domain/analytics";
import type { AnalyticsReader, AttendantScope, WorkTotals } from "../application/analytics-ports";
import type { DashboardRange, DashboardScope } from "../application/ports";

// Aggregates of the operational analytics computed by PostgreSQL (SPEC
// 2026-11-06-analises-operacionais, 5.8). Days and hours are São Paulo days and hours. Only
// counts, instants and names recorded on the request are read: never a description, a comment
// text, a document or the requester.

const TIME_ZONE = "America/Sao_Paulo";
const ACTIVE_STATUSES: RequestStatus[] = ["OPEN", "IN_PROGRESS"];

function scopeSql(scope: DashboardScope, alias = "r"): Prisma.Sql {
  return scope.sectorId ? Prisma.sql`AND ${Prisma.raw(`"${alias}"`)}."sectorId" = ${scope.sectorId}::uuid` : Prisma.empty;
}

interface AggregateRow {
  count: number;
  averageMs: number | null;
  medianMs: number | null;
}

function aggregate(row: AggregateRow | undefined): DurationAggregate {
  return { count: row?.count ?? 0, averageMs: row?.averageMs ?? null, medianMs: row?.medianMs ?? null };
}

/** Milliseconds between two timestamp expressions, for `avg` and `percentile_cont`. */
function msBetween(later: Prisma.Sql, earlier: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(extract(epoch FROM (${later} - ${earlier})) * 1000)`;
}

interface WorkRow extends AggregateRow {
  withDueDate: number;
  onTime: number;
}

export function createPrismaAnalyticsReader(database: PrismaClient): AnalyticsReader {
  async function work(sectorId: string, range: DashboardRange, assigneeId: string | null): Promise<Omit<WorkTotals, "replies">> {
    const assignee = assigneeId ? Prisma.sql`AND r."assigneeId" = ${assigneeId}::uuid` : Prisma.empty;
    const duration = msBetween(Prisma.sql`r."completedAt"`, Prisma.sql`r."createdAt"`);
    const [row] = await database.$queryRaw<WorkRow[]>`
      SELECT
        count(*)::int AS "count",
        avg(${duration})::float8 AS "averageMs",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ${duration})::float8 AS "medianMs",
        (count(*) FILTER (WHERE r."completedLate" IS NOT NULL))::int AS "withDueDate",
        (count(*) FILTER (WHERE r."completedLate" = false))::int AS "onTime"
      FROM "Request" r
      WHERE r."status" = 'COMPLETED'
        AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before}
        AND r."sectorId" = ${sectorId}::uuid
        ${assignee}`;
    return {
      completed: row?.count ?? 0,
      completion: aggregate(row),
      withDueDate: row?.withDueDate ?? 0,
      onTime: row?.onTime ?? 0,
    };
  }

  async function replies(sectorId: string, range: DashboardRange, authorId: string | null): Promise<number> {
    // Public comments of attendants only: an internal note is not an answer to the requester.
    const author = authorId ? Prisma.sql`AND c."authorId" = ${authorId}::uuid` : Prisma.empty;
    const [row] = await database.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count"
      FROM "RequestComment" c
      JOIN "Request" r ON r."id" = c."requestId"
      JOIN "User" u ON u."id" = c."authorId"
      WHERE c."isInternal" = false
        AND u."role" = 'ATTENDANT'
        AND c."createdAt" >= ${range.from} AND c."createdAt" < ${range.before}
        AND r."sectorId" = ${sectorId}::uuid
        ${author}`;
    return row?.count ?? 0;
  }

  return {
    async findSector(sectorId) {
      return database.sector.findUnique({ where: { id: sectorId }, select: { id: true, name: true, isActive: true } });
    },

    async listSectors() {
      return database.sector.findMany({ select: { id: true, name: true, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    },

    async attendantQueue(scope: AttendantScope, now: Date) {
      const sector = { sectorId: scope.sectorId };
      const active = { ...sector, status: { in: ACTIVE_STATUSES } };
      // Same SLA rules as the dashboard: a paused request is neither due soon nor overdue.
      const running = { ...active, slaPausedAt: null };
      const [unassigned, mine, dueSoon, overdue, paused, byPriority, byStage] = await Promise.all([
        database.request.count({
          where: { ...active, assigneeId: null, OR: [{ approvalState: null }, { approvalState: { not: "PENDING" } }] },
        }),
        database.request.count({ where: { ...active, assigneeId: scope.attendantId } }),
        database.request.count({ where: { ...running, dueSoonAt: { lte: now }, dueAt: { gte: now } } }),
        database.request.count({ where: { ...running, dueAt: { lt: now } } }),
        database.request.count({ where: { ...sector, slaPausedAt: { not: null } } }),
        database.request.groupBy({ by: ["priority"], where: active, _count: { _all: true } }),
        // Arrays are 1-based in SQL; without a stage the label is null ("Sem etapa").
        database.$queryRaw<Array<{ label: string | null; count: number }>>`
          SELECT r."stageNamesSnapshot"[r."stageIndex" + 1] AS "label", count(*)::int AS "count"
          FROM "Request" r
          WHERE r."status" = 'IN_PROGRESS' AND r."sectorId" = ${scope.sectorId}::uuid
          GROUP BY 1`,
      ]);
      return {
        unassigned,
        mine,
        dueSoon,
        overdue,
        paused,
        byPriority: byPriority.map((group) => ({ priority: group.priority, count: group._count._all })),
        byStage,
      };
    },

    async attendantWork(scope: AttendantScope, range: DashboardRange) {
      const [mine, sector, myReplies, sectorReplies] = await Promise.all([
        work(scope.sectorId, range, scope.attendantId),
        work(scope.sectorId, range, null),
        replies(scope.sectorId, range, scope.attendantId),
        replies(scope.sectorId, range, null),
      ]);
      return { mine: { ...mine, replies: myReplies }, sector: { ...sector, replies: sectorReplies } };
    },

    async dailyCounts(scope, range): Promise<DailyCounts[]> {
      return database.$queryRaw<DailyCounts[]>`
        WITH opened AS (
          SELECT to_char((r."createdAt" AT TIME ZONE ${TIME_ZONE})::date, 'YYYY-MM-DD') AS "day", count(*)::int AS "count"
          FROM "Request" r
          WHERE r."createdAt" >= ${range.from} AND r."createdAt" < ${range.before} ${scopeSql(scope)}
          GROUP BY 1
        ), completed AS (
          SELECT
            to_char((r."completedAt" AT TIME ZONE ${TIME_ZONE})::date, 'YYYY-MM-DD') AS "day",
            count(*)::int AS "count",
            (count(*) FILTER (WHERE r."completedLate" IS NOT NULL))::int AS "withDueDate",
            (count(*) FILTER (WHERE r."completedLate" = false))::int AS "onTime"
          FROM "Request" r
          WHERE r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before} ${scopeSql(scope)}
          GROUP BY 1
        )
        SELECT
          coalesce(o."day", c."day") AS "day",
          coalesce(o."count", 0)::int AS "opened",
          coalesce(c."count", 0)::int AS "completed",
          coalesce(c."withDueDate", 0)::int AS "withDueDate",
          coalesce(c."onTime", 0)::int AS "onTime"
        FROM opened o
        FULL JOIN completed c ON c."day" = o."day"
        ORDER BY 1`;
    },

    async pendingAt(scope, instants) {
      if (instants.length === 0) return [];
      // For each instant, the last status event before it decides whether the request was
      // pending: reopenings and cancellations count as they happened (5.4).
      const rows = await database.$queryRaw<Array<{ position: number; count: number }>>`
        SELECT t."position"::int AS "position", count(r."id")::int AS "count"
        FROM unnest(${instants.map((instant) => instant.toISOString())}::timestamptz[]) WITH ORDINALITY AS t("at", "position")
        LEFT JOIN "Request" r
          ON r."createdAt" < t."at" ${scopeSql(scope)}
          AND (
            SELECT e."toStatus" FROM "RequestStatusEvent" e
            WHERE e."requestId" = r."id" AND e."occurredAt" < t."at"
            ORDER BY e."occurredAt" DESC, e."id" DESC
            LIMIT 1
          ) IN ('OPEN', 'IN_PROGRESS')
        GROUP BY t."position"
        ORDER BY t."position"`;
      return instants.map((_, index) => rows.find((row) => row.position === index + 1)?.count ?? 0);
    },

    async firstResponse(scope, range) {
      // The first thing the requester sees from the team: a public comment of an attendant or
      // the start of the attendance, whichever comes first (5.5.1). LEAST ignores nulls.
      const [row] = await database.$queryRaw<Array<AggregateRow & { unanswered: number }>>`
        WITH opened AS (
          SELECT r."createdAt", LEAST(
            (SELECT min(c."createdAt") FROM "RequestComment" c JOIN "User" u ON u."id" = c."authorId"
              WHERE c."requestId" = r."id" AND c."isInternal" = false AND u."role" = 'ATTENDANT'),
            (SELECT min(e."occurredAt") FROM "RequestStatusEvent" e
              WHERE e."requestId" = r."id" AND e."toStatus" = 'IN_PROGRESS')
          ) AS "answeredAt"
          FROM "Request" r
          WHERE r."createdAt" >= ${range.from} AND r."createdAt" < ${range.before} ${scopeSql(scope)}
        )
        SELECT
          (count(*) FILTER (WHERE "answeredAt" IS NOT NULL))::int AS "count",
          (count(*) FILTER (WHERE "answeredAt" IS NULL))::int AS "unanswered",
          avg(${msBetween(Prisma.sql`"answeredAt"`, Prisma.sql`"createdAt"`)})::float8 AS "averageMs",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ${msBetween(Prisma.sql`"answeredAt"`, Prisma.sql`"createdAt"`)})::float8 AS "medianMs"
        FROM opened`;
      return { answered: aggregate(row), unanswered: row?.unanswered ?? 0 };
    },

    async stageTimes(scope, range): Promise<StageTimeRow[]> {
      // Each stage lasts from its event until the next stage event or the completion (5.5.2).
      const rows = await database.$queryRaw<Array<AggregateRow & { serviceName: string; stageName: string; stageOrder: number }>>`
        WITH done AS (
          SELECT r."id", r."serviceNameSnapshot", r."stageNamesSnapshot", r."completedAt"
          FROM "Request" r
          WHERE r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before} ${scopeSql(scope)}
        ), spans AS (
          SELECT
            d."serviceNameSnapshot" AS "serviceName",
            e."toStage" AS "stageName",
            array_position(d."stageNamesSnapshot", e."toStage") AS "position",
            e."occurredAt" AS "enteredAt",
            coalesce(lead(e."occurredAt") OVER (PARTITION BY e."requestId" ORDER BY e."occurredAt", e."id"), d."completedAt") AS "leftAt"
          FROM "RequestStageEvent" e
          JOIN done d ON d."id" = e."requestId"
        )
        SELECT
          "serviceName",
          "stageName",
          coalesce(min("position"), 1000)::int AS "stageOrder",
          count(*)::int AS "count",
          avg(${msBetween(Prisma.sql`"leftAt"`, Prisma.sql`"enteredAt"`)})::float8 AS "averageMs",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ${msBetween(Prisma.sql`"leftAt"`, Prisma.sql`"enteredAt"`)})::float8 AS "medianMs"
        FROM spans
        WHERE "leftAt" >= "enteredAt"
        GROUP BY "serviceName", "stageName"`;
      return rows.map((row) => ({
        serviceName: row.serviceName,
        stageName: row.stageName,
        stageOrder: row.stageOrder,
        duration: aggregate(row),
      }));
    },

    async pauses(scope, range) {
      // A pause still open at the completion counts until the completion (5.5.3).
      const [row] = await database.$queryRaw<Array<AggregateRow & { completed: number }>>`
        SELECT
          count(*)::int AS "completed",
          count(p."pausedMs")::int AS "count",
          avg(p."pausedMs")::float8 AS "averageMs",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY p."pausedMs")::float8 AS "medianMs"
        FROM "Request" r
        LEFT JOIN LATERAL (
          SELECT sum(${msBetween(Prisma.sql`coalesce(sp."resumedAt", r."completedAt")`, Prisma.sql`sp."pausedAt"`)}) AS "pausedMs"
          FROM "RequestSlaPause" sp
          WHERE sp."requestId" = r."id"
        ) p ON true
        WHERE r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before} ${scopeSql(scope)}`;
      return { completed: row?.completed ?? 0, paused: aggregate(row) };
    },

    async onTimeByService(scope, range) {
      return database.$queryRaw<Array<{ label: string; withDueDate: number; onTime: number }>>`
        SELECT
          r."serviceNameSnapshot" AS "label",
          (count(*) FILTER (WHERE r."completedLate" IS NOT NULL))::int AS "withDueDate",
          (count(*) FILTER (WHERE r."completedLate" = false))::int AS "onTime"
        FROM "Request" r
        WHERE r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before} ${scopeSql(scope)}
        GROUP BY 1`;
    },

    async onTimeByPriority(scope, range) {
      return database.$queryRaw<Array<{ priority: RequestPriority; withDueDate: number; onTime: number }>>`
        SELECT
          r."priority" AS "priority",
          (count(*) FILTER (WHERE r."completedLate" IS NOT NULL))::int AS "withDueDate",
          (count(*) FILTER (WHERE r."completedLate" = false))::int AS "onTime"
        FROM "Request" r
        WHERE r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before} ${scopeSql(scope)}
        GROUP BY 1`;
    },

    async arrivals(scope, range) {
      return database.$queryRaw<Array<{ isoWeekday: number; hour: number; count: number }>>`
        SELECT
          extract(isodow FROM (r."createdAt" AT TIME ZONE ${TIME_ZONE}))::int AS "isoWeekday",
          extract(hour FROM (r."createdAt" AT TIME ZONE ${TIME_ZONE}))::int AS "hour",
          count(*)::int AS "count"
        FROM "Request" r
        WHERE r."createdAt" >= ${range.from} AND r."createdAt" < ${range.before} ${scopeSql(scope)}
        GROUP BY 1, 2`;
    },

    async escalations(scope, range) {
      const [row] = await database.$queryRaw<Array<{ count: number }>>`
        SELECT count(DISTINCT e."requestId")::int AS "count"
        FROM "RequestEscalation" e
        JOIN "Request" r ON r."id" = e."requestId"
        WHERE e."occurredAt" >= ${range.from} AND e."occurredAt" < ${range.before} ${scopeSql(scope)}`;
      return row?.count ?? 0;
    },

    async satisfaction(scope, range) {
      // SPEC 2026-11-06-pesquisa-satisfacao, 4.7: ratings given in the period, and the share of
      // the requests completed in the period that were rated for that same completion.
      const [distribution, [rate], byService] = await Promise.all([
        database.$queryRaw<Array<{ rating: number; count: number }>>`
          SELECT s."rating"::int AS "rating", count(*)::int AS "count"
          FROM "RequestSatisfaction" s
          JOIN "Request" r ON r."id" = s."requestId"
          WHERE s."ratedAt" >= ${range.from} AND s."ratedAt" < ${range.before} ${scopeSql(scope)}
          GROUP BY 1`,
        database.$queryRaw<Array<{ completed: number; ratedCompletions: number }>>`
          SELECT
            count(*)::int AS "completed",
            -- The snapshot went through JavaScript (milliseconds); compare at that precision.
            (count(*) FILTER (WHERE date_trunc('milliseconds', s."completedAtSnapshot") = date_trunc('milliseconds', r."completedAt")))::int AS "ratedCompletions"
          FROM "Request" r
          LEFT JOIN "RequestSatisfaction" s ON s."requestId" = r."id"
          WHERE r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before} ${scopeSql(scope)}`,
        database.$queryRaw<Array<{ label: string; count: number; sum: number }>>`
          SELECT r."serviceNameSnapshot" AS "label", count(*)::int AS "count", sum(s."rating")::int AS "sum"
          FROM "RequestSatisfaction" s
          JOIN "Request" r ON r."id" = s."requestId"
          WHERE s."ratedAt" >= ${range.from} AND s."ratedAt" < ${range.before} ${scopeSql(scope)}
          GROUP BY 1`,
      ]);
      return { distribution, completed: rate?.completed ?? 0, ratedCompletions: rate?.ratedCompletions ?? 0, byService };
    },

    async team(scope, range): Promise<TeamMemberRow[]> {
      // People are the attendants responsible for requests of the scope: completed in the
      // period or still pending now (5.6). Durations exist only for the completed ones.
      const completedInPeriod = Prisma.sql`(r."status" = 'COMPLETED' AND r."completedAt" >= ${range.from} AND r."completedAt" < ${range.before})`;
      const duration = Prisma.sql`CASE WHEN ${completedInPeriod} THEN ${msBetween(Prisma.sql`r."completedAt"`, Prisma.sql`r."createdAt"`)} END`;
      const rows = await database.$queryRaw<
        Array<AggregateRow & { userId: string; name: string; isActive: boolean; sectorName: string | null; withDueDate: number; onTime: number; pendingNow: number }>
      >`
        SELECT
          u."id" AS "userId",
          u."name" AS "name",
          u."isActive" AS "isActive",
          s."name" AS "sectorName",
          (count(*) FILTER (WHERE ${completedInPeriod}))::int AS "count",
          avg(${duration})::float8 AS "averageMs",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ${duration})::float8 AS "medianMs",
          (count(*) FILTER (WHERE ${completedInPeriod} AND r."completedLate" IS NOT NULL))::int AS "withDueDate",
          (count(*) FILTER (WHERE ${completedInPeriod} AND r."completedLate" = false))::int AS "onTime",
          (count(*) FILTER (WHERE r."status" IN ('OPEN', 'IN_PROGRESS')))::int AS "pendingNow"
        FROM "Request" r
        JOIN "User" u ON u."id" = r."assigneeId"
        LEFT JOIN "Sector" s ON s."id" = u."sectorId"
        WHERE u."role" = 'ATTENDANT'
          AND (r."status" IN ('OPEN', 'IN_PROGRESS') OR ${completedInPeriod})
          ${scopeSql(scope)}
        GROUP BY u."id", u."name", u."isActive", s."name"`;
      return rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        isActive: row.isActive,
        sectorName: row.sectorName,
        completed: row.count,
        completion: aggregate(row),
        withDueDate: row.withDueDate,
        onTime: row.onTime,
        pendingNow: row.pendingNow,
      }));
    },
  };
}
