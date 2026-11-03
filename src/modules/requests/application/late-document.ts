import { randomUUID } from "node:crypto";
import { buildAttachmentStorageKey, inspectAttachment } from "@/modules/attachments";
import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { assertCanAddLateDocument, type ActiveDocumentRequirement } from "../domain/attachment-requirements";
import { lateDocumentInputSchema } from "./request-schemas";
import type { AttachmentQueryRepository, AttachmentStorage, RequestTransaction, RequestTransactionRunner } from "./ports";
import { resumeOnRequesterReply } from "./sla-pause";

// Document sent after the opening (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3). The rules
// run before anything is stored and again in the transaction that writes the row; the object is
// removed if that transaction fails, so no row points to a missing object.

async function checkedRequirement(
  transaction: RequestTransaction,
  actorId: string,
  requestId: string,
  requirementId: string,
  size: number,
): Promise<ActiveDocumentRequirement> {
  const actor = await transaction.findActor(actorId);
  const request = await transaction.findLifecycleState(requestId);

  if (!actor || !request?.serviceId) {
    throw new NotFoundError();
  }

  const requirements = await transaction.listActiveRequirements(request.serviceId);

  return assertCanAddLateDocument({
    actor,
    request,
    requirement: requirements.find(({ id }) => id === requirementId) ?? null,
    documents: await transaction.listRequestDocuments(requestId),
    size,
  });
}

export async function addLateDocument(
  input: unknown,
  transactions: RequestTransactionRunner,
  storage: AttachmentStorage,
): Promise<void> {
  const { requestId, requirementId, file } = validateInput(lateDocumentInputSchema, input);
  const actor = await requireCurrentActor();
  const size = file.bytes.length;
  const requirement = await transactions.run((transaction) =>
    checkedRequirement(transaction, actor.id, requestId, requirementId, size),
  );
  const id = randomUUID();
  const inspected = inspectAttachment(file, requirement.acceptedFormats);
  const storageKey = buildAttachmentStorageKey(requestId, id);

  await storage.put(storageKey, file.bytes, inspected.contentType);

  try {
    await transactions.run(async (transaction) => {
      const current = await checkedRequirement(transaction, actor.id, requestId, requirementId, size);
      const occurredAt = await transaction.currentTime();

      await transaction.insertAttachments([
        {
          ...inspected,
          id,
          requestId,
          requirementId: current.id,
          requirementNameSnapshot: current.name,
          requirementRequiredSnapshot: current.isRequired,
          storageKey,
          uploadedById: actor.id,
          createdAt: occurredAt,
        },
      ]);
      // Identifiers only (SPEC de eventos, 6.1).
      await transaction.recordEvent({
        type: "request.document_added",
        requestId,
        occurredAt,
        payload: { attachmentId: id, actorId: actor.id },
      });
      // SPEC 2026-11-03-pausa-sla-calendario, 5.4.2: the requester's reply resumes a paused SLA.
      await resumeOnRequesterReply(transaction, requestId, actor.id);
    });
  } catch (error) {
    await storage.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

/**
 * Requirements the requester may still send (5.3.2): active ones of the service without a
 * document, while the request is open or in progress. Anyone else gets an empty list, so the
 * page shows no form.
 */
export async function listMissingDocuments(
  requestId: unknown,
  repository: AttachmentQueryRepository,
): Promise<ActiveDocumentRequirement[]> {
  const id = validateInput(entityIdSchema, requestId);
  const actor = await requireCurrentActor();
  const pending = await repository.findMissingRequirements(id);

  if (
    !pending ||
    actor.role !== "REQUESTER" ||
    actor.id !== pending.requesterId ||
    (pending.status !== "OPEN" && pending.status !== "IN_PROGRESS")
  ) {
    return [];
  }

  return pending.requirements;
}
