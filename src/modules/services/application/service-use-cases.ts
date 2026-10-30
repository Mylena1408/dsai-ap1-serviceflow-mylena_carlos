import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import {
  activeStateSchema,
  entityIdSchema,
  serviceInputSchema,
} from "@/shared/validation";
import { assertServiceRelationships } from "../domain/relationships";
import type { ServiceRecord } from "../domain/service";
import type { ServiceRepository, ServiceTransactionRunner } from "./ports";

export async function listServices(repository: ServiceRepository): Promise<ServiceRecord[]> {
  await requireConfigurationAdministrator();

  return repository.listByName();
}

export async function createService(
  input: unknown,
  transactions: ServiceTransactionRunner,
): Promise<ServiceRecord> {
  await requireConfigurationAdministrator();
  const parsed = validateInput(serviceInputSchema, input);

  return transactions.run(async (transaction) => {
    const relationships = await transaction.loadRelationships(parsed.categoryId, parsed.sectorId);
    assertServiceRelationships(relationships, true);

    return transaction.create(parsed);
  });
}

export async function updateService(
  id: unknown,
  input: unknown,
  transactions: ServiceTransactionRunner,
): Promise<ServiceRecord> {
  await requireConfigurationAdministrator();
  const serviceId = validateInput(entityIdSchema, id);
  const parsed = validateInput(serviceInputSchema, input);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(serviceId);

    if (!current) {
      throw new NotFoundError();
    }

    const relationships = await transaction.loadRelationships(parsed.categoryId, parsed.sectorId);
    assertServiceRelationships(relationships, current.isActive);

    return transaction.update(serviceId, parsed);
  });
}

export async function setServiceActive(
  id: unknown,
  isActive: unknown,
  transactions: ServiceTransactionRunner,
): Promise<ServiceRecord> {
  await requireConfigurationAdministrator();
  const serviceId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(serviceId);

    if (!current) {
      throw new NotFoundError();
    }

    if (active) {
      const relationships = await transaction.loadRelationships(
        current.categoryId,
        current.sectorId,
      );
      assertServiceRelationships(relationships, true);
    }

    return transaction.update(serviceId, { isActive: active });
  });
}
