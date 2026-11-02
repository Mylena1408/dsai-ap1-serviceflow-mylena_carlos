import type { AuditScope } from "@/modules/audit";
import type { SectorDeactivationDependencies } from "../domain/deactivation";
import type { SectorRecord } from "../domain/sector";

export interface SectorRepository {
  listByName(): Promise<SectorRecord[]>;
}

/** Operations available inside a sector transaction. */
export interface SectorTransaction extends AuditScope {
  exists(sectorId: string): Promise<boolean>;
  create(name: string): Promise<SectorRecord>;
  update(sectorId: string, data: { name?: string; isActive?: boolean }): Promise<SectorRecord>;
  findDeactivationDependencies(sectorId: string): Promise<SectorDeactivationDependencies>;
}

/** Runs work atomically with serializable isolation. */
export interface SectorTransactionRunner {
  run<T>(work: (transaction: SectorTransaction) => Promise<T>): Promise<T>;
}
