import {
  assertCatalogSector,
  requireCatalogEditor,
  requirePublishedCatalogReader,
  type CatalogEditor,
} from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { documentRequirementInputSchema, documentRequirementMoveSchema } from "./document-requirement-schemas";
import type { DocumentRequirementRecord } from "../domain/document-requirement";
import {
  assertCanAddActiveRequirement,
  nextRequirementPosition,
  planRequirementMove,
} from "../domain/requirement-order";
import type {
  DocumentRequirementRepository,
  DocumentRequirementTransaction,
  DocumentRequirementTransactionRunner,
} from "./ports";

// Administrative configuration of per-service document requirements (SPEC 21.2).
// Requirements are only deactivated logically; there is no reactivation or physical
// deletion. Changes affect future requests only: attachments keep their own snapshots.

export async function listDocumentRequirements(
  repository: DocumentRequirementRepository,
): Promise<DocumentRequirementRecord[]> {
  const editor = await requireCatalogEditor();

  return editor.sectorId === null ? repository.listAll() : repository.listForSector(editor.sectorId);
}

// What the requester sees before opening a request (SPEC 21.4 item 1). Callers load the
// published service first; the opening itself reloads the requirements on the server.
export async function listPublishedServiceRequirements(
  serviceId: unknown,
  repository: DocumentRequirementRepository,
): Promise<DocumentRequirementRecord[]> {
  await requirePublishedCatalogReader();
  const id = validateInput(entityIdSchema, serviceId);

  return repository.listActiveForService(id);
}

export async function createDocumentRequirement(
  serviceId: unknown,
  input: unknown,
  transactions: DocumentRequirementTransactionRunner,
): Promise<DocumentRequirementRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, serviceId);
  const parsed = validateInput(documentRequirementInputSchema, input);

  return transactions.run(async (transaction) => {
    const sectorId = await transaction.findServiceSector(id);

    if (sectorId === null) {
      throw new NotFoundError();
    }

    assertCatalogSector(editor, sectorId);

    const existing = await transaction.listForService(id);
    assertCanAddActiveRequirement(existing.filter((requirement) => requirement.isActive).length);

    return transaction.create({
      serviceId: id,
      name: parsed.name,
      isRequired: parsed.isRequired,
      acceptedFormats: parsed.acceptedFormats,
      position: nextRequirementPosition(existing),
    });
  });
}

export async function updateDocumentRequirement(
  requirementId: unknown,
  input: unknown,
  transactions: DocumentRequirementTransactionRunner,
): Promise<DocumentRequirementRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, requirementId);
  const parsed = validateInput(documentRequirementInputSchema, input);

  return transactions.run(async (transaction) => {
    const current = await loadRequirement(transaction, id, editor);

    // Inactive requirements are history only (no edit, move or reactivation).
    if (!current.isActive) {
      throw new ConflictError();
    }

    return transaction.update(id, {
      name: parsed.name,
      isRequired: parsed.isRequired,
      acceptedFormats: parsed.acceptedFormats,
    });
  });
}

export async function moveDocumentRequirement(
  requirementId: unknown,
  direction: unknown,
  transactions: DocumentRequirementTransactionRunner,
): Promise<void> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, requirementId);
  const move = validateInput(documentRequirementMoveSchema, direction);

  await transactions.run(async (transaction) => {
    const current = await loadRequirement(transaction, id, editor);

    if (!current.isActive) {
      throw new ConflictError();
    }

    const activeRequirements = await transaction.listActiveForService(current.serviceId);

    for (const update of planRequirementMove(activeRequirements, id, move)) {
      await transaction.update(update.id, { position: update.position });
    }
  });
}

export async function deactivateDocumentRequirement(
  requirementId: unknown,
  transactions: DocumentRequirementTransactionRunner,
): Promise<DocumentRequirementRecord> {
  const editor = await requireCatalogEditor();
  const id = validateInput(entityIdSchema, requirementId);

  return transactions.run(async (transaction) => {
    const current = await loadRequirement(transaction, id, editor);

    if (!current.isActive) {
      return current;
    }

    return transaction.update(id, { isActive: false });
  });
}

async function loadRequirement(
  transaction: DocumentRequirementTransaction,
  id: string,
  editor: CatalogEditor,
): Promise<DocumentRequirementRecord> {
  const requirement = await transaction.find(id);

  if (!requirement) {
    throw new NotFoundError();
  }

  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.1: only the editor's sector.
  assertCatalogSector(editor, (await transaction.findServiceSector(requirement.serviceId)) ?? "");

  return requirement;
}
