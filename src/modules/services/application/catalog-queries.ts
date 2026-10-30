import { requirePublishedCatalogReader } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import type { PublishedService } from "../domain/service";
import type { PublishedCatalogRepository } from "./ports";

export async function listPublishedServices(
  repository: PublishedCatalogRepository,
): Promise<PublishedService[]> {
  await requirePublishedCatalogReader();

  return repository.listPublished();
}

export async function getPublishedService(
  id: unknown,
  repository: PublishedCatalogRepository,
): Promise<PublishedService> {
  await requirePublishedCatalogReader();
  const serviceId = validateInput(entityIdSchema, id);
  const service = await repository.findPublished(serviceId);

  if (!service) {
    throw new NotFoundError();
  }

  return service;
}
