import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as auditTrail from "./application/audit-trail";
import { createPrismaAuditTrailReader } from "./infrastructure/prisma-audit-trail-reader";

// Audit trail and personal data (SPEC 2026-11-02-auditoria-lgpd).
export {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_TYPES,
  AUDIT_FIELD_LABELS,
  AUDITED_FIELDS,
  PERSONAL_FIELDS,
  activeStateAction,
  auditChanges,
  describeAuditChange,
  planAuditEntry,
} from "./domain/audit";
export type {
  AuditAction,
  AuditActor,
  AuditActorRole,
  AuditMeta,
  AuditChange,
  AuditEntityType,
  AuditInputValue,
  AuditSnapshot,
  AuditValue,
  AuditValueFormatter,
} from "./domain/audit";
export type {
  AuditChangeItem,
  AuditScope,
  AuditTrailEntity,
  AuditTrailItem,
  PermissionItem,
} from "./application/ports";
export { AUDIT_PAGE_SIZE, AUDIT_TRAIL_ENTITIES } from "./application/audit-trail";
export type { AuditTrail } from "./application/audit-trail";
// For the transactions of the administrative modules (decision D5).
export { createPrismaAuditScope } from "./infrastructure/prisma-audit-scope";

/** "Auditoria" section of the administration (section 5.2). */
export async function listAuditTrail(
  params: Record<string, string | string[] | undefined>,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<auditTrail.AuditTrail> {
  return auditTrail.listAuditTrail(params, createPrismaAuditTrailReader(database), now);
}
