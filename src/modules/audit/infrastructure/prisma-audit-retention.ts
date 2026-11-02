import type { PrismaClient } from "@prisma/client";

// Retention of the audit trail (SPEC 2026-11-02-auditoria-lgpd, 5.3): the only way records leave.

/** Audit entries that occurred before `before`. */
export async function purgeAuditEntries(database: PrismaClient, before: Date): Promise<number> {
  const result = await database.auditEntry.deleteMany({ where: { occurredAt: { lt: before } } });
  return result.count;
}
