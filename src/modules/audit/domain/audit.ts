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
  // SPEC 2026-11-02-api-externa-webhooks, 5.7: token revocation and a new webhook secret.
  "REVOKED",
  "SECRET_ROTATED",
  // SPEC 2026-11-03-pausa-sla-calendario, 5.9: a holiday is removed, not deactivated.
  "DELETED",
] as const;

export const AUDIT_ENTITY_TYPES = [
  "USER",
  "SECTOR",
  "CATEGORY",
  "SERVICE",
  "DOCUMENT_REQUIREMENT",
  "SERVICE_FIELD",
  "SERVICE_STAGE",
  "API_TOKEN",
  "WEBHOOK",
  // SPEC 2026-11-03-pausa-sla-calendario, 5.9.
  "BUSINESS_CALENDAR",
  "HOLIDAY",
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
  API_TOKEN: [],
  WEBHOOK: [],
  BUSINESS_CALENDAR: [],
  HOLIDAY: [],
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
  REVOKED: "Revogou",
  SECRET_ROTATED: "Gerou novo segredo",
  DELETED: "Removeu",
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  USER: "Usuário",
  SECTOR: "Setor",
  CATEGORY: "Categoria",
  SERVICE: "Serviço",
  DOCUMENT_REQUIREMENT: "Documento exigido",
  SERVICE_FIELD: "Campo personalizado",
  SERVICE_STAGE: "Etapa",
  API_TOKEN: "Token de API",
  WEBHOOK: "Webhook",
  BUSINESS_CALENDAR: "Calendário",
  HOLIDAY: "Feriado",
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
  slaBusinessHours: "Prazo em horas úteis",
  isRequired: "Obrigatório",
  acceptedFormats: "Formatos aceitos",
  label: "Rótulo",
  helpText: "Texto de ajuda",
  type: "Tipo",
  minValue: "Mínimo",
  maxValue: "Máximo",
  options: "Opções",
  position: "Posição",
  scope: "Escopo",
  expiresAt: "Válido até",
  revokedAt: "Revogado em",
  url: "Endereço",
  eventTypes: "Eventos",
  sectorIds: "Setores",
  weekdays: "Dias de expediente",
  startTime: "Início do expediente",
  endTime: "Fim do expediente",
  timeZone: "Fuso horário",
  day: "Data",
  yearly: "Repete todo ano",
  audience: "Quem preenche",
  conditionFieldId: "Condição (campo)",
  conditionValue: "Condição (valor)",
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

/** Fields kept in a record for each entity (section 5.1); anything else, like hashes, is left out. */
export const AUDITED_FIELDS: Readonly<Record<AuditEntityType, readonly string[]>> = {
  USER: ["name", "email", "role", "sectorId", "isActive"],
  SECTOR: ["name", "isActive"],
  CATEGORY: ["name", "isActive"],
  SERVICE: ["name", "description", "categoryId", "sectorId", "defaultPriority", "slaHours", "requiresApproval", "slaBusinessHours", "isActive"],
  DOCUMENT_REQUIREMENT: ["name", "isRequired", "acceptedFormats", "position", "isActive"],
  // "audience" and the condition: SPEC 2026-11-03-campos-condicionais-atendimento, 5.7.4.
  SERVICE_FIELD: ["label", "helpText", "type", "isRequired", "options", "minValue", "maxValue", "position", "isActive", "audience", "conditionFieldId", "conditionValue"],
  SERVICE_STAGE: ["name", "position", "isActive"],
  // Never the token value, its hash or the webhook secret (SPEC 2026-11-02-api-externa-webhooks, 5.7).
  API_TOKEN: ["name", "scope", "expiresAt", "revokedAt"],
  WEBHOOK: ["name", "url", "eventTypes", "sectorIds", "isActive"],
  // The window is recorded as "HH:MM" and the weekdays by name, as the screen shows them.
  BUSINESS_CALENDAR: ["weekdays", "startTime", "endTime", "timeZone"],
  HOLIDAY: ["day", "name", "yearly"],
};

export type AuditActorRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface AuditActor {
  id: string;
  role: AuditActorRole;
}

/** What a use case says about a change; the states come from the database. */
export interface AuditMeta {
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  /** Absent for a creation: the entity gets its id from the change itself. */
  entityId?: string;
}

export interface PlannedAuditEntry {
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  changes: AuditChange[];
}

/** Actions that only exist when something changed (CA-AUD-02). */
const CHANGE_ACTIONS: readonly AuditAction[] = ["UPDATED", "REORDERED", "DEACTIVATED", "REACTIVATED"];

function audited(entityType: AuditEntityType, state: object | null): AuditSnapshot | null {
  if (state === null) return null;
  const source = state as Record<string, AuditInputValue>;
  return Object.fromEntries(AUDITED_FIELDS[entityType].filter((field) => field in source).map((field) => [field, source[field]]));
}

/**
 * The entry to write for a change, or null when there is nothing to record: an update,
 * reordering, deactivation or reactivation that changed no audited field.
 */
export function planAuditEntry(
  meta: AuditMeta & { entityId: string; entityLabel: string },
  before: object | null,
  after: object,
): PlannedAuditEntry | null {
  const changes = auditChanges(meta.entityType, audited(meta.entityType, before), audited(meta.entityType, after) ?? {});

  if (CHANGE_ACTIONS.includes(meta.action) && changes.length === 0) {
    return null;
  }

  return {
    actorId: meta.actor.id,
    actorRole: meta.actor.role,
    action: meta.action,
    entityType: meta.entityType,
    entityId: meta.entityId,
    entityLabel: meta.entityLabel,
    changes,
  };
}

/** Deactivation or reactivation, from the requested state. */
export function activeStateAction(isActive: boolean): AuditAction {
  return isActive ? "REACTIVATED" : "DEACTIVATED";
}
