import type { AuditScope } from "@/modules/audit";
import type { ConditionController } from "@/modules/service-fields";
import type { PositionedItem } from "@/shared/ordering";
import type { ServiceStageRecord } from "../domain/service-stage";

export interface ServiceStageRepository {
  /** All stages grouped by service, active first, in display order. */
  listAll(): Promise<ServiceStageRecord[]>;
  /** The same list, only for the services of one sector. */
  listForSector(sectorId: string): Promise<ServiceStageRecord[]>;
  /**
   * Active attendants, by name, of every sector or of one (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 5.3.1). Optional for older doubles.
   */
  listActiveAttendants?(sectorId: string | null): Promise<Array<{ id: string; name: string; sectorId: string }>>;
}

/** Operations available inside a stage configuration transaction. */
export interface ServiceStageTransaction extends AuditScope {
  /** Sector of the service, or null when it does not exist (SPEC de permissões, 5.3.1). */
  findServiceSector(serviceId: string): Promise<string | null>;
  listForService(serviceId: string): Promise<Array<PositionedItem & { name: string; isActive: boolean }>>;
  find(stageId: string): Promise<ServiceStageRecord | null>;
  create(data: { serviceId: string; name: string; position: number }): Promise<ServiceStageRecord>;
  update(
    stageId: string,
    data: {
      name?: string;
      isActive?: boolean;
      position?: number;
      assigneeId?: string | null;
      targetDays?: number | null;
      conditionFieldId?: string | null;
      conditionValue?: string | null;
    },
  ): Promise<ServiceStageRecord>;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1: the user named as the stage's attendant. */
  findUser?(userId: string): Promise<{ role: string; isActive: boolean; sectorId: string | null } | null>;
  /** 5.3.3: a field of this service, as the condition rules read it, or null. */
  findConditionField?(fieldId: string, serviceId: string): Promise<ConditionController | null>;
}

/** Runs work atomically with serializable isolation. */
export interface ServiceStageTransactionRunner {
  run<T>(work: (transaction: ServiceStageTransaction) => Promise<T>): Promise<T>;
}
