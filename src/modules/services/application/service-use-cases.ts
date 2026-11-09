import { assertCatalogSector, requireCatalogEditor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { activeStateAction } from "@/modules/audit";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { serviceApprovalInputSchema, serviceInputSchema, type ServiceInput } from "./service-schemas";
import { assertApprovalLevels } from "../domain/approval-config";
import { assertConditionTarget } from "@/modules/service-fields";
import { assertServiceRelationships } from "../domain/relationships";
import type { ServiceData, ServiceRecord } from "../domain/service";
import { parseEstimatedHours, parseSlaHours } from "../domain/sla-config";
import type { ServiceRepository, ServiceTransactionRunner } from "./ports";

function serviceData(parsed: ServiceInput): ServiceData {
  const { defaultPriority, slaHours, requiresApproval, slaBusinessHours, estimatedHours, ...base } = parsed;
  return {
    ...base,
    ...(defaultPriority !== undefined ? { defaultPriority } : {}),
    ...(slaHours !== undefined ? { slaHours: parseSlaHours(slaHours) } : {}),
    ...(requiresApproval !== undefined ? { requiresApproval } : {}),
    ...(slaBusinessHours !== undefined ? { slaBusinessHours } : {}),
    ...(estimatedHours !== undefined ? { estimatedHours: parseEstimatedHours(estimatedHours) } : {}),
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

    return transaction.audited({ actor: editor.actor, action: "CREATED", entityType: "SERVICE" }, () => transaction.create(data));
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

    return transaction.audited({ actor: editor.actor, action: "UPDATED", entityType: "SERVICE", entityId: serviceId }, () =>
      transaction.update(serviceId, data),
    );
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

    return transaction.audited(
      { actor: editor.actor, action: activeStateAction(active), entityType: "SERVICE", entityId: serviceId },
      () => transaction.update(serviceId, { isActive: active }),
    );
  });
}

/**
 * Approval levels and condition of a service (SPEC 2026-11-06-aprofundamento-configurabilidade,
 * 4.3.1 and 4.3.7). Whoever configures the service does it (decision G19); any active sector may
 * be a level, because a level only says who approves. The condition follows the rules of the
 * conditional fields (decision G18): an active requester field of this service, with choices,
 * without its own condition, and one of its values. Recorded in the audit as a service update.
 */
export async function configureServiceApproval(
  id: unknown,
  input: unknown,
  transactions: ServiceTransactionRunner,
): Promise<ServiceRecord> {
  const editor = await requireCatalogEditor();
  const serviceId = validateInput(entityIdSchema, id);
  const parsed = validateInput(serviceApprovalInputSchema, input);

  return transactions.run(async (transaction) => {
    const current = await transaction.findState(serviceId);

    if (!current) {
      throw new NotFoundError();
    }

    assertCatalogSector(editor, current.sectorId);
    assertApprovalLevels(parsed.sectorIds, await transaction.activeSectorIds(parsed.sectorIds));

    if (parsed.conditionFieldId !== null) {
      const controller = await transaction.findConditionField(parsed.conditionFieldId, serviceId);
      assertConditionTarget({ id: null, audience: "REQUESTER" }, controller, parsed.conditionValue ?? "");
    }

    return transaction.audited({ actor: editor.actor, action: "UPDATED", entityType: "SERVICE", entityId: serviceId }, () =>
      transaction.update(serviceId, {
        approvalSectorIds: parsed.sectorIds,
        approvalConditionFieldId: parsed.conditionFieldId,
        approvalConditionValue: parsed.conditionValue,
        // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6.
        ...(parsed.deadlineDays !== undefined ? { approvalDeadlineDays: parsed.deadlineDays } : {}),
      }),
    );
  });
}
