import type { PositionedItem } from "@/shared/ordering";
import type { ServiceStageRecord } from "../domain/service-stage";

export interface ServiceStageRepository {
  /** All stages grouped by service, active first, in display order. */
  listAll(): Promise<ServiceStageRecord[]>;
}

/** Operations available inside a stage configuration transaction. */
export interface ServiceStageTransaction {
  serviceExists(serviceId: string): Promise<boolean>;
  listForService(serviceId: string): Promise<Array<PositionedItem & { name: string; isActive: boolean }>>;
  find(stageId: string): Promise<ServiceStageRecord | null>;
  create(data: { serviceId: string; name: string; position: number }): Promise<ServiceStageRecord>;
  update(
    stageId: string,
    data: { name?: string; isActive?: boolean; position?: number },
  ): Promise<ServiceStageRecord>;
}

/** Runs work atomically with serializable isolation. */
export interface ServiceStageTransactionRunner {
  run<T>(work: (transaction: ServiceStageTransaction) => Promise<T>): Promise<T>;
}
