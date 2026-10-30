export interface RequestSnapshotSource {
  id: string;
  name: string;
  description: string;
  category: { id: string; name: string };
  sector: { id: string; name: string };
}

export function buildRequestSnapshot(
  requesterId: string,
  service: RequestSnapshotSource,
) {
  return {
    requesterId,
    serviceId: service.id,
    sectorId: service.sector.id,
    serviceNameSnapshot: service.name,
    serviceDescriptionSnapshot: service.description,
    categoryIdSnapshot: service.category.id,
    categoryNameSnapshot: service.category.name,
    sectorNameSnapshot: service.sector.name,
  };
}

export type RequestSnapshot = ReturnType<typeof buildRequestSnapshot>;
