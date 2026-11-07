import type { AuditScope } from "@/modules/audit";
import type { ConditionController } from "@/modules/service-fields";
import type { ServiceRelationships } from "../domain/relationships";
import type { PublishedService, ServiceData, ServiceRecord } from "../domain/service";

export interface ServiceRepository {
  /** All services ordered by name, for administration. */
  listByName(): Promise<ServiceRecord[]>;
}

export interface PublishedCatalogRepository {
  /** Active services whose category and sector are active, ordered by category and name. */
  listPublished(): Promise<PublishedService[]>;
  findPublished(serviceId: string): Promise<PublishedService | null>;
}

export interface ServiceState {
  id: string;
  isActive: boolean;
  categoryId: string;
  sectorId: string;
}

/** Operations available inside a service transaction. */
export interface ServiceTransaction extends AuditScope {
  findState(serviceId: string): Promise<ServiceState | null>;
  loadRelationships(categoryId: string, sectorId: string): Promise<ServiceRelationships>;
  create(data: ServiceData): Promise<ServiceRecord>;
  update(serviceId: string, data: Partial<ServiceData> & { isActive?: boolean }): Promise<ServiceRecord>;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1: which of these sectors are active. */
  activeSectorIds(sectorIds: readonly string[]): Promise<Set<string>>;
  /** 4.3.7: a field of this service, as the condition rules read it, or null. */
  findConditionField(fieldId: string, serviceId: string): Promise<ConditionController | null>;
}

/** Runs work atomically with serializable isolation. */
export interface ServiceTransactionRunner {
  run<T>(work: (transaction: ServiceTransaction) => Promise<T>): Promise<T>;
}
