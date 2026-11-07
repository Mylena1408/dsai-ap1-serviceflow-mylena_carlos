import type { AuditScope } from "@/modules/audit";
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

/**
 * A field of the service as the configuration rules read it. The condition columns are optional
 * so doubles written before SPEC 2026-11-03-campos-condicionais-atendimento stay valid.
 */
export type ServiceFieldSummary = PositionedItem & { label: string; isActive: boolean } & Partial<
    Pick<ServiceFieldRecord, "type" | "options" | "audience" | "conditionFieldId" | "conditionValue">
  >;

/** Operations available inside a custom field transaction. */
export interface ServiceFieldTransaction extends AuditScope {
  /** Sector of the service, or null when it does not exist (SPEC de permissões, 5.3.1). */
  findServiceSector(serviceId: string): Promise<string | null>;
  listForService(serviceId: string): Promise<ServiceFieldSummary[]>;
  find(fieldId: string): Promise<ServiceFieldRecord | null>;
  /**
   * The value of the service's approval condition that uses this field, or null (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 4.3.7). Optional for older doubles: absent = none.
   */
  findApprovalConditionValue?(fieldId: string): Promise<string | null>;
  /**
   * Values of the active stages' conditions that use this field (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 5.3.3). Optional for older doubles: absent = none.
   */
  findStageConditionValues?(fieldId: string): Promise<string[]>;
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
