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
export type { AuditScope } from "./application/ports";
// For the transactions of the administrative modules (decision D5).
export { createPrismaAuditScope } from "./infrastructure/prisma-audit-scope";
