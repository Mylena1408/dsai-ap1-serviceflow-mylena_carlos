import { sha256Hex } from "@/modules/attachments";
import { actorHasPermission, assertRequestReadable, requireCurrentActor } from "@/server/authorization";
import { InternalServerError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import type { AttachmentDownload, RequestAttachmentSummary } from "../domain/attachment";
import type { AttachmentContentReader, AttachmentQueryRepository } from "./ports";

// Attachment reads follow the request read rule on every call (SPEC 21.5): the requester
// who opened it or an attendant of its current sector; administrators are denied. Every
// denial is a NotFoundError, so the response never reveals that the attachment exists.

export async function authorizeRequestRead(
  requestId: unknown,
  repository: Pick<AttachmentQueryRepository, "findRequestScope">,
) {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, requestId);
  const scope = await repository.findRequestScope(id);

  if (!scope) {
    throw new NotFoundError();
  }

  // SPEC 2026-11-01-permissoes-configuraveis, 5.3.2: a manager may read every request of the sector.
  const sectorReader =
    actor.role === "MANAGER" && !scope.requiresApproval && (await actorHasPermission(actor, "SECTOR_REQUESTS_READ"));
  assertRequestReadable(actor, scope, { sectorReader });
  return id;
}

export async function listRequestAttachments(
  requestId: unknown,
  repository: AttachmentQueryRepository,
): Promise<RequestAttachmentSummary[]> {
  const id = await authorizeRequestRead(requestId, repository);

  return repository.listForRequest(id);
}

export async function getAttachmentDownload(
  requestId: unknown,
  attachmentId: unknown,
  repository: AttachmentQueryRepository,
  storage: AttachmentContentReader,
): Promise<AttachmentDownload> {
  const id = await authorizeRequestRead(requestId, repository);
  const attachment = await repository.findInRequest(id, validateInput(entityIdSchema, attachmentId));

  if (!attachment) {
    throw new NotFoundError();
  }

  const bytes = await storage.get(attachment.storageKey);

  // Content that differs from the recorded metadata is never served (SPEC 21.15.6).
  if (bytes.length !== attachment.sizeBytes || sha256Hex(bytes) !== attachment.sha256) {
    throw new InternalServerError();
  }

  return {
    filename: attachment.originalFilename,
    contentType: attachment.contentType,
    bytes,
  };
}
