import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuditTrailFilter, AuditTrailItem, AuditTrailReader } from "../application/ports";
import type { AuditAction, AuditActorRole, AuditChange, AuditEntityType } from "../domain/audit";

// The "Auditoria" section reads the audit entries and the permission history together, in one
// query, so the order and the pages are the database's (SPEC 2026-11-02-auditoria-lgpd, 5.2).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Both sources with the same columns; permission events read as the entity "PERMISSION". */
const TRAIL = Prisma.sql`
  SELECT
    a."id", a."occurredAt", a."actorId", 'change' AS "kind", a."actorRole"::text AS "recordedRole",
    a."action"::text AS "action", a."entityType"::text AS "entityType", a."entityId"::text AS "entityId",
    a."entityLabel", a."changes", NULL::text AS "permission", NULL::text AS "expiresOn"
  FROM "AuditEntry" a
  UNION ALL
  SELECT
    e."id", e."occurredAt", e."actorId"::text, 'permission', NULL,
    e."action"::text, 'PERMISSION', e."userId"::text,
    u."name", '[]'::jsonb, e."permission"::text, to_char(e."expiresOn", 'YYYY-MM-DD')
  FROM "UserPermissionEvent" e
  JOIN "User" u ON u."id" = e."userId"`;

function conditions(filter: AuditTrailFilter): Prisma.Sql {
  return Prisma.sql`
    WHERE t."occurredAt" >= ${filter.from}
      AND t."occurredAt" < ${filter.before}
      ${filter.entity ? Prisma.sql`AND t."entityType" = ${filter.entity}` : Prisma.empty}
      ${filter.actorId ? Prisma.sql`AND t."actorId" = ${filter.actorId}` : Prisma.empty}`;
}

interface TrailRow {
  id: string;
  occurredAt: Date;
  actorId: string;
  kind: "change" | "permission";
  actorRole: AuditActorRole | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  changes: AuditChange[];
  permission: string | null;
  expiresOn: string | null;
}

function toItem(row: TrailRow): AuditTrailItem {
  const base = {
    id: row.id,
    occurredAt: row.occurredAt,
    actorId: row.actorId,
    actorName: row.actorName,
    actorRole: row.actorRole,
  };

  if (row.kind === "permission") {
    return {
      ...base,
      kind: "permission",
      action: row.action as "GRANTED" | "REVOKED",
      permission: row.permission as "SECTOR_SERVICES" | "SECTOR_REQUESTS_READ" | "QUEUE_SUPERVISION",
      userName: row.entityLabel,
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2: the end given with the grant.
      expiresOn: row.expiresOn,
    };
  }

  return {
    ...base,
    kind: "change",
    action: row.action as AuditAction,
    entityType: row.entityType as AuditEntityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    changes: row.changes,
  };
}

export function createPrismaAuditTrailReader(database: PrismaClient): AuditTrailReader {
  return {
    async count(filter) {
      const [{ total }] = await database.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS "total" FROM (${TRAIL}) t ${conditions(filter)}`;
      return total;
    },

    async list(filter, skip, take) {
      // The role recorded with an entry; permission events take the person's current role.
      const rows = await database.$queryRaw<TrailRow[]>`
        SELECT t.*, p."name" AS "actorName", COALESCE(t."recordedRole", p."role"::text) AS "actorRole"
        FROM (${TRAIL}) t
        LEFT JOIN "User" p ON p."id"::text = t."actorId"
        ${conditions(filter)}
        ORDER BY t."occurredAt" DESC, t."id" DESC
        LIMIT ${take} OFFSET ${skip}`;
      return rows.map(toItem);
    },

    async actors() {
      const rows = await database.$queryRaw<Array<{ id: string; name: string | null }>>`
        SELECT DISTINCT t."actorId" AS "id", p."name"
        FROM (SELECT "actorId" FROM "AuditEntry" UNION SELECT "actorId"::text FROM "UserPermissionEvent") t
        LEFT JOIN "User" p ON p."id"::text = t."actorId"`;
      return rows
        .map((row) => ({ id: row.id, name: row.name ?? "Pessoa não encontrada" }))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id));
    },

    async names(ids) {
      const valid = ids.filter((id) => UUID.test(id));
      const [sectors, categories, people, services] = await Promise.all([
        database.sector.findMany({ where: { id: { in: valid } }, select: { id: true, name: true } }),
        database.category.findMany({ where: { id: { in: valid } }, select: { id: true, name: true } }),
        // The people of an escalation rule, by their current names (as the actors).
        database.user.findMany({ where: { id: { in: valid } }, select: { id: true, name: true } }),
        // The services of a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2).
        database.service.findMany({ where: { id: { in: valid } }, select: { id: true, name: true } }),
      ]);
      return Object.fromEntries([...sectors, ...categories, ...people, ...services].map((row) => [row.id, row.name]));
    },
  };
}
