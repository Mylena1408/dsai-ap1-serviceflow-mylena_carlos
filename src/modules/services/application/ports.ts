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
export interface ServiceTransaction {
  findState(serviceId: string): Promise<ServiceState | null>;
  loadRelationships(categoryId: string, sectorId: string): Promise<ServiceRelationships>;
  create(data: ServiceData): Promise<ServiceRecord>;
  update(serviceId: string, data: Partial<ServiceData> & { isActive?: boolean }): Promise<ServiceRecord>;
}

/** Runs work atomically with serializable isolation. */
export interface ServiceTransactionRunner {
  run<T>(work: (transaction: ServiceTransaction) => Promise<T>): Promise<T>;
}
