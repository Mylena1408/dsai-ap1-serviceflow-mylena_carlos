import { assertCatalogSector, requireCatalogEditor, type CatalogEditor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { nextPosition, planPositionMove } from "@/shared/ordering";
import { entityIdSchema } from "@/shared/validation";
import { serviceStageInputSchema, serviceStageMoveSchema } from "./service-stage-schemas";
import {
  assertCanAddActiveStage,
  assertStageNameAvailable,
  type ServiceStageRecord,
} from "../domain/service-stage";
import type { ServiceStageRepository, ServiceStageTransaction, ServiceStageTransactionRunner } from "./ports";

// Administrative configuration of the attendance flow (SPEC 2026-11-01-fluxos-configuraveis,
// 5.1). Stages are deactivated, never deleted, and can be reactivated. Requests already in
// progress keep the copy taken when their attendance started (decision W3).

export async function listServiceStages(repository: ServiceStageRepository): Promise<ServiceStageRecord[]> {
  const editor = await requireCatalogEditor();

  return editor.sectorId === null ? repository.listAll() : repository.listForSector(editor.sectorId);
}

export async function createServiceStage(
  serviceId: unknown,
  input: unknown,
  transactions: ServiceStageTransactionRunner,
): Promise<ServiceStageRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, serviceId);
  const { name } = validateInput(serviceStageInputSchema, input);

  return transactions.run(async (transaction) => {
    const sectorId = await transaction.findServiceSector(id);

    if (sectorId === null) {
      throw new NotFoundError();
    }

    assertCatalogSector(editor, sectorId);

    const existing = await transaction.listForService(id);
    const active = existing.filter((stage) => stage.isActive);
    assertCanAddActiveStage(active.length);
    assertStageNameAvailable(active, name);

    return transaction.create({ serviceId: id, name, position: nextPosition(existing) });
  });
}

export async function renameServiceStage(
  stageId: unknown,
  input: unknown,
  transactions: ServiceStageTransactionRunner,
): Promise<ServiceStageRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, stageId);
  const { name } = validateInput(serviceStageInputSchema, input);

  return transactions.run(async (transaction) => {
    const current = await loadStage(transaction, id, editor);

    // Inactive stages are only reactivated, never edited.
    if (!current.isActive) {
      throw new ConflictError();
    }

    const others = (await transaction.listForService(current.serviceId)).filter(
      (stage) => stage.isActive && stage.id !== id,
    );
    assertStageNameAvailable(others, name);

    return transaction.update(id, { name });
  });
}

export async function moveServiceStage(
  stageId: unknown,
  direction: unknown,
  transactions: ServiceStageTransactionRunner,
): Promise<void> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, stageId);
  const move = validateInput(serviceStageMoveSchema, direction);

  await transactions.run(async (transaction) => {
    const current = await loadStage(transaction, id, editor);

    if (!current.isActive) {
      throw new ConflictError();
    }

    const active = (await transaction.listForService(current.serviceId)).filter((stage) => stage.isActive);

    for (const update of planPositionMove(active, id, move)) {
      await transaction.update(update.id, { position: update.position });
    }
  });
}

export async function deactivateServiceStage(
  stageId: unknown,
  transactions: ServiceStageTransactionRunner,
): Promise<ServiceStageRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, stageId);

  return transactions.run(async (transaction) => {
    const current = await loadStage(transaction, id, editor);

    return current.isActive ? transaction.update(id, { isActive: false }) : current;
  });
}

// A reactivated stage goes to the end of the flow, within the limit and without repeating the
// name of another active stage (section 5.1 item 4).
export async function reactivateServiceStage(
  stageId: unknown,
  transactions: ServiceStageTransactionRunner,
): Promise<ServiceStageRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, stageId);

  return transactions.run(async (transaction) => {
    const current = await loadStage(transaction, id, editor);

    if (current.isActive) {
      return current;
    }

    const existing = await transaction.listForService(current.serviceId);
    const active = existing.filter((stage) => stage.isActive);
    assertCanAddActiveStage(active.length);
    assertStageNameAvailable(active, current.name);

    return transaction.update(id, { isActive: true, position: nextPosition(existing) });
  });
}

async function loadStage(
  transaction: ServiceStageTransaction,
  id: string,
  editor: CatalogEditor,
): Promise<ServiceStageRecord> {
  const stage = await transaction.find(id);

  if (!stage) {
    throw new NotFoundError();
  }

  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.1: only the editor's sector.
  assertCatalogSector(editor, (await transaction.findServiceSector(stage.serviceId)) ?? "");

  return stage;
}
