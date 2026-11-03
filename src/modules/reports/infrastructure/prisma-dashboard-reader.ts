import { Prisma, type PrismaClient, type RequestStatus } from "@prisma/client";
import type { DashboardRange, DashboardReader, DashboardScope, ExportRequestRow } from "../application/ports";

// Aggregates of the dashboard computed by PostgreSQL (SPEC 2026-11-02-painel-relatorios, 5.6).

const ACTIVE_STATUSES: RequestStatus[] = ["OPEN", "IN_PROGRESS"];

function scopeWhere(scope: DashboardScope): Prisma.RequestWhereInput {
  return scope.sectorId ? { sectorId: scope.sectorId } : {};
}

function scopeSql(scope: DashboardScope): Prisma.Sql {
  return scope.sectorId ? Prisma.sql`AND "sectorId" = ${scope.sectorId}::uuid` : Prisma.empty;
}

function inRange(range: DashboardRange) {
  return { gte: range.from, lt: range.before };
}

interface CompletionRow {
  count: number;
  averageMs: number | null;
  medianMs: number | null;
  withDueDate: number;
  onTime: number;
}

export function createPrismaDashboardReader(database: PrismaClient): DashboardReader {
  return {
    async findSector(sectorId) {
      return database.sector.findUnique({ where: { id: sectorId }, select: { id: true, name: true, isActive: true } });
    },

    async listSectors() {
      return database.sector.findMany({
        select: { id: true, name: true, isActive: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },

    async currentCounts(scope, now) {
      const where = scopeWhere(scope);
      // Same rules as `slaSituation` and the queue filter: at the due date itself, still "due soon".
      // SPEC 2026-11-03-pausa-sla-calendario, 5.7: a paused request is neither due soon nor overdue.
      const running = { status: { in: ACTIVE_STATUSES }, slaPausedAt: null };
      const [open, awaitingApproval, inProgress, dueSoon, overdue, paused] = await Promise.all([
        database.request.count({ where: { ...where, status: "OPEN" } }),
        database.request.count({ where: { ...where, status: "OPEN", approvalState: "PENDING" } }),
        database.request.count({ where: { ...where, status: "IN_PROGRESS" } }),
        database.request.count({
          where: { ...where, ...running, dueSoonAt: { lte: now }, dueAt: { gte: now } },
        }),
        database.request.count({ where: { ...where, ...running, dueAt: { lt: now } } }),
        database.request.count({ where: { ...where, slaPausedAt: { not: null } } }),
      ]);
      return { open, awaitingApproval, inProgress, dueSoon, overdue, paused };
    },

    async periodTotals(scope, range) {
      const where = scopeWhere(scope);
      const opened = { ...where, createdAt: inRange(range) };
      const [openedCount, completed, cancelled, [completion], byCategory, bySector, byStatus] = await Promise.all([
        database.request.count({ where: opened }),
        database.request.count({ where: { ...where, status: "COMPLETED", completedAt: inRange(range) } }),
        database.request.count({ where: { ...where, status: "CANCELLED", cancelledAt: inRange(range) } }),
        // A reopened request keeps its original opening, so it counts from there (section 5.3).
        database.$queryRaw<CompletionRow[]>`
          SELECT
            count(*)::int AS "count",
            avg(extract(epoch FROM ("completedAt" - "createdAt")) * 1000)::float8 AS "averageMs",
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("completedAt" - "createdAt")) * 1000)::float8 AS "medianMs",
            (count(*) FILTER (WHERE "completedLate" IS NOT NULL))::int AS "withDueDate",
            (count(*) FILTER (WHERE "completedLate" = false))::int AS "onTime"
          FROM "Request"
          WHERE "status" = 'COMPLETED'
            AND "completedAt" >= ${range.from}
            AND "completedAt" < ${range.before}
            ${scopeSql(scope)}`,
        database.request.groupBy({ by: ["categoryNameSnapshot"], where: opened, _count: { _all: true } }),
        database.request.groupBy({ by: ["sectorNameSnapshot"], where: opened, _count: { _all: true } }),
        database.request.groupBy({ by: ["status"], where: opened, _count: { _all: true } }),
      ]);

      return {
        opened: openedCount,
        completed,
        cancelled,
        completion:
          completion.count === 0 || completion.averageMs === null || completion.medianMs === null
            ? null
            : { averageMs: completion.averageMs, medianMs: completion.medianMs },
        withDueDate: completion.withDueDate,
        onTime: completion.onTime,
        byCategory: byCategory.map((group) => ({ label: group.categoryNameSnapshot, count: group._count._all })),
        bySector: bySector.map((group) => ({ label: group.sectorNameSnapshot, count: group._count._all })),
        byStatus: byStatus.map((group) => ({ status: group.status, count: group._count._all })),
      };
    },

    async listForExport(scope, range, limit) {
      const rows = await database.request.findMany({
        where: { ...scopeWhere(scope), createdAt: inRange(range) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
        // Only the columns of section 5.4: nothing about the content or the requester.
        select: {
          id: true,
          serviceNameSnapshot: true,
          categoryNameSnapshot: true,
          sectorNameSnapshot: true,
          status: true,
          priority: true,
          approvalState: true,
          stageNamesSnapshot: true,
          stageIndex: true,
          assignee: { select: { name: true } },
          createdAt: true,
          completedAt: true,
          cancelledAt: true,
          dueAt: true,
          completedLate: true,
          slaHoursSnapshot: true,
          slaBusinessHours: true,
          dueSoonAt: true,
          slaPausedAt: true,
        },
      });

      return rows.map(
        (row): ExportRequestRow => ({
          id: row.id,
          serviceName: row.serviceNameSnapshot,
          categoryName: row.categoryNameSnapshot,
          sectorName: row.sectorNameSnapshot,
          status: row.status,
          priority: row.priority,
          approvalState: row.approvalState,
          stageName: row.stageIndex === null ? null : (row.stageNamesSnapshot[row.stageIndex] ?? null),
          assigneeName: row.assignee?.name ?? null,
          createdAt: row.createdAt,
          completedAt: row.completedAt,
          cancelledAt: row.cancelledAt,
          dueAt: row.dueAt,
          completedLate: row.completedLate,
          slaHoursSnapshot: row.slaHoursSnapshot,
          // SPEC 2026-11-03-pausa-sla-calendario: only when they change the situation.
          ...(row.slaBusinessHours ? { slaBusinessHours: true as const, dueSoonAt: row.dueSoonAt } : {}),
          ...(row.slaPausedAt ? { slaPausedAt: row.slaPausedAt } : {}),
        }),
      );
    },
  };
}
