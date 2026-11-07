import type { ServicePriority } from "./sla-config";

export interface ServiceRecord {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  sectorId: string;
  isActive: boolean;
  /** SPEC 2026-11-01 (SLA e prioridades). */
  defaultPriority: ServicePriority;
  slaHours: number | null;
  /** SPEC 2026-11-01 (aprovações), 5.2. */
  requiresApproval: boolean;
  /** SPEC 2026-11-03-pausa-sla-calendario, 5.2: the SLA counts only business hours. */
  slaBusinessHours: boolean;
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1 and 4.3.7: level sectors (empty = the
   * service's sector) and the condition. Optional so older doubles stay valid.
   */
  approvalSectorIds?: string[];
  approvalConditionFieldId?: string | null;
  approvalConditionValue?: string | null;
  /** 4.3.6: days to decide each level. */
  approvalDeadlineDays?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceData {
  name: string;
  description: string;
  categoryId: string;
  sectorId: string;
  /** Omitted keeps the current value (create: NORMAL and no SLA). */
  defaultPriority?: ServicePriority;
  slaHours?: number | null;
  /** Omitted keeps the current value (create: no approval). */
  requiresApproval?: boolean;
  /** Omitted keeps the current value (create: calendar hours). */
  slaBusinessHours?: boolean;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3: written only by the approval configuration. */
  approvalSectorIds?: string[];
  approvalConditionFieldId?: string | null;
  approvalConditionValue?: string | null;
  /** 4.3.6: days to decide each level. */
  approvalDeadlineDays?: number | null;
}

export interface PublishedService extends ServiceRecord {
  category: { id: string; name: string };
  sector: { id: string; name: string };
}

export function groupPublishedServices(
  services: PublishedService[],
): Map<string, PublishedService[]> {
  const groups = new Map<string, PublishedService[]>();

  for (const service of services) {
    const group = groups.get(service.category.name) ?? [];
    group.push(service);
    groups.set(service.category.name, group);
  }

  return groups;
}
