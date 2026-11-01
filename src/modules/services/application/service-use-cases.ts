import { assertCatalogSector, requireCatalogEditor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { serviceInputSchema, type ServiceInput } from "./service-schemas";
import { assertServiceRelationships } from "../domain/relationships";
import type { ServiceData, ServiceRecord } from "../domain/service";
import { parseSlaHours } from "../domain/sla-config";
import type { ServiceRepository, ServiceTransactionRunner } from "./ports";

function serviceData(parsed: ServiceInput): ServiceData {
  const { defaultPriority, slaHours, requiresApproval, ...base } = parsed;
  return {
    ...base,
    ...(defaultPriority !== undefined ? { defaultPriority } : {}),
    ...(slaHours !== undefined ? { slaHours: parseSlaHours(slaHours) } : {}),
    ...(requiresApproval !== undefined ? { requiresApproval } : {}),
  };
}

// SPEC 2026-11-01-permissoes-configuraveis, 5.3.1: the administrator configures every service;
// a holder of "Gerir serviços do setor" only the services of the own sector, never moving one.
export async function listServices(repository: ServiceRepository): Promise<ServiceRecord[]> {
  const editor = await requireCatalogEditor();
  const services = await repository.listByName();

  return editor.sectorId === null ? services : services.filter((service) => service.sectorId === editor.sectorId);
}

export async function createService(
  input: unknown,
  transactions: ServiceTransactionRunner,
): Promise<ServiceRecord> {
  const editor = await requireCatalogEditor();
  const parsed = validateInput(serviceInputSchema, input);
  const data = serviceData(parsed);
  assertCatalogSector(editor, parsed.sectorId);

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
  const editor = await requireCatalogEditor();
  const serviceId = validateInput(entityIdSchema, id);
  const parsed = validateInput(serviceInputSchema, input);
  const data = serviceData(parsed);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(serviceId);

    if (!current) {
      throw new NotFoundError();
    }

    assertCatalogSector(editor, current.sectorId);
    assertCatalogSector(editor, parsed.sectorId);
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
  const editor = await requireCatalogEditor();
  const serviceId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(serviceId);

    if (!current) {
      throw new NotFoundError();
    }

    assertCatalogSector(editor, current.sectorId);

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
