// Audit trail and personal data (SPEC 2026-11-02-auditoria-lgpd).
export {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_TYPES,
  AUDIT_FIELD_LABELS,
  PERSONAL_FIELDS,
  auditChanges,
  describeAuditChange,
} from "./domain/audit";
export type {
  AuditAction,
  AuditChange,
  AuditEntityType,
  AuditInputValue,
  AuditSnapshot,
  AuditValue,
  AuditValueFormatter,
} from "./domain/audit";
