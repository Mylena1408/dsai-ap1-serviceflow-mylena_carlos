import { ConflictError, NotFoundError } from "@/server/errors";

export interface ServiceRelationships {
  categoryExists: boolean;
  categoryActive: boolean;
  sectorExists: boolean;
  sectorActive: boolean;
}

export function assertServiceRelationships(
  relationships: ServiceRelationships,
  requiresActiveRelationships: boolean,
): void {
  if (!relationships.categoryExists || !relationships.sectorExists) {
    throw new NotFoundError();
  }

  if (
    requiresActiveRelationships &&
    (!relationships.categoryActive || !relationships.sectorActive)
  ) {
    throw new ConflictError();
  }
}

export function assertServiceCanReceiveRequests(input: {
  isActive: boolean;
  categoryActive: boolean;
  sectorActive: boolean;
}): void {
  if (!input.isActive) {
    throw new NotFoundError();
  }

  assertServiceRelationships(
    {
      categoryExists: true,
      categoryActive: input.categoryActive,
      sectorExists: true,
      sectorActive: input.sectorActive,
    },
    true,
  );
}
