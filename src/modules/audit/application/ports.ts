import type { AuditMeta } from "../domain/audit";

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
