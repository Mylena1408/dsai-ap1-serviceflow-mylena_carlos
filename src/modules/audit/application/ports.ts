import type { AuditAction, AuditActor, AuditActorRole, AuditChange, AuditEntityType, AuditMeta } from "../domain/audit";
import type { PersonalDataSource } from "../domain/personal-data";

// The single point that records the audit trail (SPEC 2026-11-02-auditoria-lgpd, decision D5).
// Transactions of the administrative modules extend it, so the record is written inside the same
// transaction as the change: if the change fails, nothing is recorded.

export interface AuditScope {
  /**
   * Runs `change` and records it: reads the entity before and after, inside the transaction,
   * and writes an entry only when an audited field changed (or always, for a creation).
   */
  audited<T extends { id: string }>(meta: AuditMeta, change: () => Promise<T>): Promise<T>;
}

// Reading of the "Auditoria" section (section 5.2): the audit entries and, together with them,
// the permission history of SPEC 2026-11-01-permissoes-configuraveis, never copied.

/** Every audited entity, plus the permission grants and revocations. */
export type AuditTrailEntity = AuditEntityType | "PERMISSION";

export interface AuditTrailFilter {
  from: Date;
  before: Date;
  entity: AuditTrailEntity | null;
  actorId: string | null;
}

interface AuditTrailItemBase {
  id: string;
  occurredAt: Date;
  actorId: string;
  /** Current name of the person; null when no user has that id. */
  actorName: string | null;
  actorRole: AuditActorRole | null;
}

export interface AuditChangeItem extends AuditTrailItemBase {
  kind: "change";
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  changes: AuditChange[];
}

export interface PermissionItem extends AuditTrailItemBase {
  kind: "permission";
  action: "GRANTED" | "REVOKED";
  permission: "SECTOR_SERVICES" | "SECTOR_REQUESTS_READ" | "QUEUE_SUPERVISION";
  userName: string;
}

export type AuditTrailItem = AuditChangeItem | PermissionItem;

export interface AuditTrailReader {
  count(filter: AuditTrailFilter): Promise<number>;
  /** Most recent first. */
  list(filter: AuditTrailFilter, skip: number, take: number): Promise<AuditTrailItem[]>;
  /** People who appear in the trail, by name. */
  actors(): Promise<Array<{ id: string; name: string }>>;
  /** Names of sectors and categories, to read changes of `sectorId` and `categoryId`. */
  names(ids: readonly string[]): Promise<Record<string, string>>;
}

/** "Meus dados" (section 5.4): the person's own data and the record of each export. */
export interface PersonalDataReader {
  load(userId: string): Promise<PersonalDataSource | null>;
  /** Writes the "EXPORTED" audit entry; the label is the person's current name. */
  recordExport(actor: AuditActor): Promise<void>;
}
