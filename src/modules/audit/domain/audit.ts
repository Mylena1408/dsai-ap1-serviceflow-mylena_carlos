// Audit trail of administrative changes (SPEC 2026-11-02-auditoria-lgpd, 5.1 and 5.2): which
// fields changed, how each change reads in Portuguese, and what never enters a record.

export const AUDIT_ACTIONS = [
  "CREATED",
  "UPDATED",
  "REORDERED",
  "DEACTIVATED",
  "REACTIVATED",
  "ANONYMIZED",
  "EXPORTED",
] as const;

export const AUDIT_ENTITY_TYPES = [
  "USER",
  "SECTOR",
  "CATEGORY",
  "SERVICE",
  "DOCUMENT_REQUIREMENT",
  "SERVICE_FIELD",
  "SERVICE_STAGE",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** A field value as stored in the record (JSON); dates become ISO text. */
export type AuditValue = string | number | boolean | null | readonly string[];
/** What a caller may pass: dates and absent values are normalized. */
export type AuditInputValue = AuditValue | Date | undefined;
export type AuditSnapshot = Readonly<Record<string, AuditInputValue>>;

/** A changed field: its values, or only the fact that it changed for personal fields. */
export type AuditChange =
  | { field: string; before: AuditValue; after: AuditValue }
  | { field: string; personal: true };

/** Personal data: the record says the field changed, never its values (section 5.1). */
export const PERSONAL_FIELDS: Readonly<Record<AuditEntityType, readonly string[]>> = {
  USER: ["name", "email"],
  SECTOR: [],
  CATEGORY: [],
  SERVICE: [],
  DOCUMENT_REQUIREMENT: [],
  SERVICE_FIELD: [],
  SERVICE_STAGE: [],
};

/** Passwords, hashes, secrets and tokens never enter a record, whatever the entity. */
const SECRET_FIELD = /password|hash|secret|token/i;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATED: "Criou",
  UPDATED: "Alterou",
  REORDERED: "Reordenou",
  DEACTIVATED: "Desativou",
  REACTIVATED: "Reativou",
  ANONYMIZED: "Anonimizou",
  EXPORTED: "Baixou os próprios dados",
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  USER: "Usuário",
  SECTOR: "Setor",
  CATEGORY: "Categoria",
  SERVICE: "Serviço",
  DOCUMENT_REQUIREMENT: "Documento exigido",
  SERVICE_FIELD: "Campo personalizado",
  SERVICE_STAGE: "Etapa",
};

/** Names of the recorded fields; an unknown field shows its own name. */
export const AUDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Nome",
  email: "E-mail",
  role: "Perfil",
  sectorId: "Setor",
  isActive: "Ativo",
  description: "Descrição",
  categoryId: "Categoria",
  defaultPriority: "Prioridade padrão",
  slaHours: "Prazo-base (horas)",
  requiresApproval: "Exige aprovação",
  isRequired: "Obrigatório",
  acceptedFormats: "Formatos aceitos",
  label: "Rótulo",
  helpText: "Texto de ajuda",
  type: "Tipo",
  minValue: "Mínimo",
  maxValue: "Máximo",
  options: "Opções",
  position: "Posição",
};

function normalize(value: AuditInputValue): AuditValue {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function same(left: AuditValue, right: AuditValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Changed fields between two states of an entity, in the order they appear. `before` is null for
 * a creation, which records every field with a value. Secrets are dropped; personal fields only
 * say they changed. No change, no entry: an empty list means nothing to record (CA-AUD-02).
 */
export function auditChanges(entityType: AuditEntityType, before: AuditSnapshot | null, after: AuditSnapshot): AuditChange[] {
  const fields = [...new Set([...Object.keys(after), ...Object.keys(before ?? {})])];
  const changes: AuditChange[] = [];

  for (const field of fields) {
    if (SECRET_FIELD.test(field)) continue;

    const previous = before === null ? null : normalize(before[field]);
    const next = normalize(after[field]);
    if (same(previous, next)) continue;

    changes.push(PERSONAL_FIELDS[entityType].includes(field) ? { field, personal: true } : { field, before: previous, after: next });
  }

  return changes;
}

/** Formats a value for reading; the screen can name ids and enum values (sectors, profiles). */
export type AuditValueFormatter = (field: string, value: AuditValue) => string | undefined;

function readable(field: string, value: AuditValue, format?: AuditValueFormatter): string {
  const custom = format?.(field, value);
  if (custom !== undefined) return custom;
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  return String(value);
}

/** "Exige aprovação: Não → Sim", "E-mail: alterado" (section 5.2). */
export function describeAuditChange(change: AuditChange, format?: AuditValueFormatter): string {
  const label = AUDIT_FIELD_LABELS[change.field] ?? change.field;

  if ("personal" in change) {
    return `${label}: alterado`;
  }

  return `${label}: ${readable(change.field, change.before, format)} → ${readable(change.field, change.after, format)}`;
}
