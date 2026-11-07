import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_CALENDAR } from "@/shared/business-clock";
import { PERMISSIONS, type Permission } from "@/shared/permissions";

// Permissions a person holds now (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1 and
// 6.3.2): the union of the individual grants and of the active roles assigned, each counting up to
// the end of its last day in the organization's time zone. Read on every operation, so a removal,
// a deactivated role or an end that has passed counts at once, without a job or a new login.
// Whether the profile and the sector let a permission count stays with @/shared/permissions.

type Client = PrismaClient | Prisma.TransactionClient;

/** The organization's calendar day now ("YYYY-MM-DD"), by the database clock. */
export async function organizationToday(client: Client): Promise<string> {
  const [row] = await client.$queryRaw<Array<{ day: string }>>`
    SELECT to_char(now() AT TIME ZONE coalesce(
      (SELECT "timeZone" FROM "BusinessCalendar" WHERE "id" = 1),
      ${DEFAULT_CALENDAR.timeZone}
    ), 'YYYY-MM-DD') AS "day"
  `;
  return row.day;
}

export async function loadEffectivePermissions(client: Client, userId: string): Promise<Permission[]> {
  const rows = await client.$queryRaw<Array<{ permission: string }>>`
    WITH "today" AS (
      SELECT (now() AT TIME ZONE coalesce(
        (SELECT "timeZone" FROM "BusinessCalendar" WHERE "id" = 1),
        ${DEFAULT_CALENDAR.timeZone}
      ))::date AS "day"
    )
    SELECT "grant"."permission"::text AS "permission"
    FROM "UserPermission" AS "grant", "today"
    WHERE "grant"."userId" = ${userId}::uuid
      AND ("grant"."expiresOn" IS NULL OR "grant"."expiresOn" >= "today"."day")
    UNION
    SELECT unnest("role"."permissions")::text AS "permission"
    FROM "UserAccessRole" AS "assignment"
    JOIN "AccessRole" AS "role" ON "role"."id" = "assignment"."roleId"
    CROSS JOIN "today"
    WHERE "assignment"."userId" = ${userId}::uuid
      AND "role"."isActive"
      AND ("assignment"."expiresOn" IS NULL OR "assignment"."expiresOn" >= "today"."day")
  `;
  const held = new Set(rows.map((row) => row.permission));

  return PERMISSIONS.filter((permission) => held.has(permission));
}
