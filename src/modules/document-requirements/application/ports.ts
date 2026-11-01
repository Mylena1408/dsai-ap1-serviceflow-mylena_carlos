import type {
  DocumentRequirementData,
  DocumentRequirementRecord,
} from "../domain/document-requirement";
import type { OrderedRequirement } from "../domain/requirement-order";

export interface DocumentRequirementRepository {
  /** All requirements grouped by service, active first, in display order. */
  listAll(): Promise<DocumentRequirementRecord[]>;
  /** The same list, only for the services of one sector. */
  listForSector(sectorId: string): Promise<DocumentRequirementRecord[]>;
  /** Active requirements of one service, in display order. */
  listActiveForService(serviceId: string): Promise<DocumentRequirementRecord[]>;
}

/** Operations available inside a document requirement transaction. */
export interface DocumentRequirementTransaction {
  /** Sector of the service, or null when it does not exist (SPEC de permissões, 5.3.1). */
  findServiceSector(serviceId: string): Promise<string | null>;
  listForService(serviceId: string): Promise<Array<OrderedRequirement & { isActive: boolean }>>;
  listActiveForService(serviceId: string): Promise<OrderedRequirement[]>;
  find(requirementId: string): Promise<DocumentRequirementRecord | null>;
  create(
    data: DocumentRequirementData & { serviceId: string; position: number },
  ): Promise<DocumentRequirementRecord>;
  update(
    requirementId: string,
    data: Partial<DocumentRequirementData> & { isActive?: boolean; position?: number },
  ): Promise<DocumentRequirementRecord>;
}

/** Runs work atomically with serializable isolation. */
export interface DocumentRequirementTransactionRunner {
  run<T>(work: (transaction: DocumentRequirementTransaction) => Promise<T>): Promise<T>;
}
