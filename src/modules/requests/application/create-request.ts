import { randomUUID } from "node:crypto";
import {
  assertAttachmentBatchLimits,
  buildAttachmentStorageKey,
  inspectAttachment,
  type InspectedAttachment,
} from "@/modules/attachments";
import { requireRequestCreator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { requestCreationInputSchema, type RequestCreationInput } from "./request-schemas";
import { assertServiceCanReceiveRequests } from "@/modules/services";
import { assertFieldAnswers, collectFieldAnswers, type FieldAnswer } from "@/modules/service-fields";
import {
  assertFormatStillAccepted,
  matchAttachmentsToRequirements,
  type ActiveDocumentRequirement,
} from "../domain/attachment-requirements";
import type { RequestWithHistory } from "../domain/request";
import { approvalStateOnOpening, dueAtOnOpening } from "../domain/approval";
import { buildRequestSnapshot } from "../domain/snapshot";
import type {
  AttachmentStorage,
  RequestTransaction,
  RequestTransactionRunner,
  ServiceForRequest,
} from "./ports";

/** A validated file with its server-generated identifiers, ready to be stored. */
interface PreparedAttachment extends InspectedAttachment {
  id: string;
  requirementId: string;
  storageKey: string;
  bytes: Uint8Array;
}

// Storage used when a request carries no files: nothing is ever written.
const noStorage: AttachmentStorage = {
  async put() {
    throw new Error("Attachment storage was not provided.");
  },
  async remove() {},
};

/**
 * Opens a request, with the files required by the service when it has active document
 * requirements (SPEC 2026-09-30, sections 21.4 and 21.15.4). Objects are written before
 * the transaction and removed again if it fails, so no attachment row ever points to a
 * missing object.
 */
export async function createRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
  storage: AttachmentStorage = noStorage,
): Promise<RequestWithHistory> {
  const actor = await requireRequestCreator();
  const parsed = validateInput(requestCreationInputSchema, input);
  const uploads = parsed.attachments ?? [];
  const requestId = randomUUID();

  if (uploads.length === 0) {
    return transactions.run((transaction) =>
      openRequest(transaction, actor.id, parsed, requestId, []),
    );
  }

  assertAttachmentBatchLimits(uploads.map(({ bytes }) => ({ size: bytes.length })));

  // Field answers are checked before any file is stored, so a refused form writes nothing.
  const requirements = await transactions.run(async (transaction) => {
    const { service } = await loadOpeningContext(transaction, actor.id, parsed.serviceId);
    await fieldAnswers(transaction, service.id, parsed);
    return transaction.listActiveRequirements(service.id);
  });
  const prepared = matchAttachmentsToRequirements(requirements, uploads).map(
    ({ attachment, requirement }): PreparedAttachment => {
      const id = randomUUID();

      return {
        ...inspectAttachment(attachment, requirement.acceptedFormats),
        id,
        requirementId: requirement.id,
        storageKey: buildAttachmentStorageKey(requestId, id),
        bytes: attachment.bytes,
      };
    },
  );

  const written: string[] = [];

  try {
    for (const attachment of prepared) {
      await storage.put(attachment.storageKey, attachment.bytes, attachment.contentType);
      written.push(attachment.storageKey);
    }

    return await transactions.run((transaction) =>
      openRequest(transaction, actor.id, parsed, requestId, prepared),
    );
  } catch (error) {
    await removeWrittenObjects(storage, written);
    throw error;
  }
}

async function loadOpeningContext(
  transaction: RequestTransaction,
  actorId: string,
  serviceId: string,
): Promise<{ actorId: string; service: ServiceForRequest }> {
  const currentActor = await transaction.findActor(actorId);

  if (
    !currentActor ||
    !currentActor.isActive ||
    currentActor.role !== "REQUESTER"
  ) {
    throw new NotFoundError();
  }

  const service = await transaction.findServiceForRequest(serviceId);

  if (!service) {
    throw new NotFoundError();
  }

  assertServiceCanReceiveRequests({
    isActive: service.isActive,
    categoryActive: service.category.isActive,
    sectorActive: service.sector.isActive,
  });

  return { actorId: currentActor.id, service };
}

// SPEC 2026-11-01-campos-personalizados, 5.3.2: answers are checked against the active fields
// loaded in this transaction; a form built with another configuration is refused.
async function fieldAnswers(
  transaction: RequestTransaction,
  serviceId: string,
  parsed: RequestCreationInput,
): Promise<FieldAnswer[]> {
  const fields = await transaction.listActiveFields(serviceId);

  return assertFieldAnswers(collectFieldAnswers(fields, new Map(Object.entries(parsed.fieldValues ?? {}))));
}

async function openRequest(
  transaction: RequestTransaction,
  actorId: string,
  parsed: RequestCreationInput,
  requestId: string,
  prepared: readonly PreparedAttachment[],
): Promise<RequestWithHistory> {
  const context = await loadOpeningContext(transaction, actorId, parsed.serviceId);
  const answers = await fieldAnswers(transaction, context.service.id, parsed);

  // The configuration in force when the transaction runs prevails (SPEC 21.4 item 5).
  const requirements: ActiveDocumentRequirement[] = await transaction.listActiveRequirements(
    context.service.id,
  );
  const matches = matchAttachmentsToRequirements(requirements, prepared);

  for (const { attachment, requirement } of matches) {
    assertFormatStillAccepted(requirement, attachment.detectedFormat);
  }

  const openedAt = await transaction.currentTime();
  const approvalState = approvalStateOnOpening(context.service.requiresApproval);
  const created = await transaction.insertRequest({
    ...buildRequestSnapshot(context.actorId, context.service),
    id: requestId,
    description: parsed.description,
    status: "OPEN",
    openedAt,
    // SPEC 2026-11-01, sections 5.1 to 5.3: default priority and SLA snapshot of the service.
    priority: context.service.defaultPriority,
    slaHoursSnapshot: context.service.slaHours,
    // SPEC 2026-11-01-aprovacoes, 5.2 and 5.5: with approval, pending and without a due date.
    approvalState,
    dueAt: dueAtOnOpening(openedAt, context.service.slaHours, context.service.defaultPriority, approvalState),
  });

  await transaction.insertStatusEvent({
    requestId: created.id,
    actorId: context.actorId,
    fromStatus: null,
    toStatus: "OPEN",
    occurredAt: openedAt,
  });
  await transaction.recordEvent({
    type: "request.opened",
    requestId: created.id,
    occurredAt: openedAt,
    payload: { requesterId: context.actorId, sectorId: context.service.sector.id },
  });

  if (matches.length > 0) {
    await transaction.insertAttachments(
      matches.map(({ attachment, requirement }) => ({
        id: attachment.id,
        requestId: created.id,
        requirementId: requirement.id,
        requirementNameSnapshot: requirement.name,
        requirementRequiredSnapshot: requirement.isRequired,
        originalFilename: attachment.originalFilename,
        detectedFormat: attachment.detectedFormat,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        sha256: attachment.sha256,
        storageKey: attachment.storageKey,
        uploadedById: context.actorId,
        createdAt: openedAt,
      })),
    );
  }

  if (answers.length > 0) {
    await transaction.insertFieldValues(
      answers.map((answer) => ({ ...answer, requestId: created.id, createdAt: openedAt })),
    );
  }

  return transaction.getWithHistory(created.id);
}

// Compensation (SPEC 21.15.5). A failed removal leaves an object that no route can read,
// because downloads only follow attachment rows. The log carries only a correlation id,
// the object count and the error code: never keys, file names or content.
async function removeWrittenObjects(storage: AttachmentStorage, keys: readonly string[]) {
  const failures: string[] = [];

  for (const key of keys) {
    try {
      await storage.remove(key);
    } catch (error) {
      failures.push(
        typeof error === "object" && error !== null && "reason" in error
          ? String(error.reason)
          : "UNKNOWN",
      );
    }
  }

  if (failures.length > 0) {
    console.error("Attachment compensation failed.", {
      correlationId: randomUUID(),
      objects: failures.length,
      reason: failures[0],
    });
  }
}
