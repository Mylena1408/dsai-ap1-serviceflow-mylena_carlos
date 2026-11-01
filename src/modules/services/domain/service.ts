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
