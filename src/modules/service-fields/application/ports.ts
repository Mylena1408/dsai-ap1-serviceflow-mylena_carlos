import type { PositionedItem } from "@/shared/ordering";
import type { ServiceFieldDefinition, ServiceFieldRecord } from "../domain/service-field";

export interface ServiceFieldRepository {
  /** All fields grouped by service, active first, in display order. */
  listAll(): Promise<ServiceFieldRecord[]>;
  /** The same list, only for the services of one sector. */
  listForSector(sectorId: string): Promise<ServiceFieldRecord[]>;
  /** Active fields of one service, in display order. */
  listActiveForService(serviceId: string): Promise<ServiceFieldRecord[]>;
}

/** Operations available inside a custom field transaction. */
export interface ServiceFieldTransaction {
  /** Sector of the service, or null when it does not exist (SPEC de permissões, 5.3.1). */
  findServiceSector(serviceId: string): Promise<string | null>;
  listForService(serviceId: string): Promise<Array<PositionedItem & { label: string; isActive: boolean }>>;
  find(fieldId: string): Promise<ServiceFieldRecord | null>;
  create(data: ServiceFieldDefinition & { serviceId: string; position: number }): Promise<ServiceFieldRecord>;
  update(
    fieldId: string,
    data: Partial<Omit<ServiceFieldDefinition, "type">> & { isActive?: boolean; position?: number },
  ): Promise<ServiceFieldRecord>;
}

/** Runs work atomically with serializable isolation. */
export interface ServiceFieldTransactionRunner {
  run<T>(work: (transaction: ServiceFieldTransaction) => Promise<T>): Promise<T>;
}
