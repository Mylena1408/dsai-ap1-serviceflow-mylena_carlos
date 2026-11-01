import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { serviceInputSchema, type ServiceInput } from "./service-schemas";
import { assertServiceRelationships } from "../domain/relationships";
import type { ServiceData, ServiceRecord } from "../domain/service";
import { parseSlaHours } from "../domain/sla-config";
import type { ServiceRepository, ServiceTransactionRunner } from "./ports";

function serviceData(parsed: ServiceInput): ServiceData {
  const { defaultPriority, slaHours, ...base } = parsed;
  return {
    ...base,
    ...(defaultPriority !== undefined ? { defaultPriority } : {}),
    ...(slaHours !== undefined ? { slaHours: parseSlaHours(slaHours) } : {}),
  };
}

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
  const data = serviceData(parsed);

  return transactions.run(async (transaction) => {
    const relationships = await transaction.loadRelationships(parsed.categoryId, parsed.sectorId);
    assertServiceRelationships(relationships, true);

    return transaction.create(data);
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
  const data = serviceData(parsed);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(serviceId);

    if (!current) {
      throw new NotFoundError();
    }

    const relationships = await transaction.loadRelationships(parsed.categoryId, parsed.sectorId);
    assertServiceRelationships(relationships, current.isActive);

    return transaction.update(serviceId, data);
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
