import { randomUUID } from "node:crypto";
import {
  assertCommentFileLimits,
  buildAttachmentStorageKey,
  inspectCommentFile,
  type InspectedAttachment,
} from "@/modules/attachments";
import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { assertCanComment, canSeeComment, commentAudience, normalizeCommentBody } from "../domain/comment-policy";
import { commentFileDownloadSchema, commentInputSchema } from "./comment-schemas";
import { planMentions } from "../domain/mentions";
import type {
  CommentFileStorage,
  CommentRecord,
  CommentRepository,
  CommentTransaction,
  CommentTransactionRunner,
} from "./ports";

// Comments on a request (SPEC 2026-10-31-comentarios), with files (SPEC 2026-11-03-anexos-
// comentarios-documentos). Every call reloads the reader and the request, so a sector change or
// deactivation applies immediately.

/** A validated file with its server-generated identifiers, ready to be stored. */
interface PreparedFile extends InspectedAttachment {
  id: string;
  storageKey: string;
  bytes: Uint8Array;
}

// Storage used when a comment carries no files: nothing is ever written.
const noStorage: CommentFileStorage = {
  async put() {
    throw new Error("Comment file storage was not provided.");
  },
  async get() {
    throw new Error("Comment file storage was not provided.");
  },
  async remove() {},
};

interface CommentDraft {
  requestId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 1. */
  mentionIds: readonly string[];
}

/** Reloads reader and request, checks who may comment and, with files, the room left (5.1). */
async function checkComment(transaction: CommentTransaction, draft: CommentDraft, files: readonly { size: number }[]) {
  const reader = await transaction.findReader(draft.authorId);
  const request = await transaction.findRequestScope(draft.requestId);

  if (!reader || !request) {
    throw new NotFoundError();
  }

  assertCanComment(reader, request, draft.isInternal);

  if (files.length > 0) {
    assertCommentFileLimits(files, await transaction.countFiles(draft.requestId));
  }

  return reader;
}

async function saveComment(
  transaction: CommentTransaction,
  draft: CommentDraft,
  commentId: string,
  files: readonly PreparedFile[],
): Promise<CommentRecord> {
  const reader = await checkComment(transaction, draft, files.map(({ sizeBytes }) => ({ size: sizeBytes })));
  // SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 1: checked before anything is written.
  const mentions =
    draft.mentionIds.length === 0
      ? []
      : planMentions(draft.mentionIds, {
          authorId: reader.id,
          isInternal: draft.isInternal,
          mentionableIds: new Set(
            transaction.listMentionableIds ? await transaction.listMentionableIds((await transaction.findRequestScope(draft.requestId))!.sectorId) : [],
          ),
        });
  const createdAt = await transaction.currentTime();
  const comment = await transaction.insertComment({
    id: commentId,
    requestId: draft.requestId,
    authorId: reader.id,
    body: draft.body,
    isInternal: draft.isInternal,
    createdAt,
  });

  if (files.length > 0) {
    await transaction.insertFiles(
      files.map((file) => ({
        id: file.id,
        requestId: draft.requestId,
        commentId,
        originalFilename: file.originalFilename,
        detectedFormat: file.detectedFormat,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        storageKey: file.storageKey,
        uploadedById: reader.id,
        createdAt,
      })),
    );
  }

  if (mentions.length > 0) {
    await transaction.insertMentions?.(commentId, mentions, createdAt);
  }

  // Identifiers only: the text never goes to the outbox (SPEC de eventos, 6.1).
  await transaction.recordEvent({
    type: "request.comment_added",
    requestId: comment.requestId,
    occurredAt: comment.createdAt,
    payload: { commentId: comment.id, authorId: comment.author.id, isInternal: comment.isInternal },
  });

  if (!draft.isInternal) {
    await transaction.resumeSlaOnRequesterReply?.(draft.requestId, reader.id);
  }

  // SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2: only attendants (the requester already follows their own).
  if (reader.role === "ATTENDANT") {
    await transaction.followOnComment?.(draft.requestId, reader.id, createdAt);
  }

  return {
    ...comment,
    files: files.map(({ id, originalFilename, detectedFormat, sizeBytes }) => ({ id, originalFilename, detectedFormat, sizeBytes, removed: false })),
  };
}

async function removeWrittenObjects(storage: CommentFileStorage, keys: readonly string[]): Promise<void> {
  // Best effort: an object left behind has no row and is removed by the orphan cleanup only when
  // its request does not exist; the error that caused the rollback is the one reported.
  await Promise.allSettled(keys.map((key) => storage.remove(key)));
}

/**
 * Sections 5.1 to 5.3 of the comments SPEC, with files (5.1 of the files SPEC): author and time
 * come from the session and the database clock. Files are checked before anything is stored,
 * written before the transaction and removed again if it fails, so no file row ever points to a
 * missing object.
 */
export async function addComment(
  input: unknown,
  transactions: CommentTransactionRunner,
  storage: CommentFileStorage = noStorage,
): Promise<CommentRecord> {
  const parsed = validateInput(commentInputSchema, input);
  const body = normalizeCommentBody(parsed.body);
  const actor = await requireCurrentActor();
  const draft: CommentDraft = {
    requestId: parsed.requestId,
    authorId: actor.id,
    body,
    isInternal: parsed.isInternal,
    mentionIds: parsed.mentionIds ?? [],
  };
  const uploads = parsed.files ?? [];
  const commentId = randomUUID();

  if (uploads.length === 0) {
    return transactions.run((transaction) => saveComment(transaction, draft, commentId, []));
  }

  // Who may comment and the room left are checked before any file is inspected or stored.
  const sizes = uploads.map(({ bytes }) => ({ size: bytes.length }));
  assertCommentFileLimits(sizes, 0);
  await transactions.run((transaction) => checkComment(transaction, draft, sizes));

  const prepared = uploads.map((upload): PreparedFile => {
    const id = randomUUID();
    return { ...inspectCommentFile(upload), id, storageKey: buildAttachmentStorageKey(parsed.requestId, id), bytes: upload.bytes };
  });
  const written: string[] = [];

  try {
    for (const file of prepared) {
      await storage.put(file.storageKey, file.bytes, file.contentType);
      written.push(file.storageKey);
    }

    return await transactions.run((transaction) => saveComment(transaction, draft, commentId, prepared));
  } catch (error) {
    await removeWrittenObjects(storage, written);
    throw error;
  }
}

/** The conversation as the reader may see it: internal notes only for attendants. */
export async function listComments(
  requestId: unknown,
  repository: CommentRepository,
): Promise<CommentRecord[]> {
  const id = validateInput(entityIdSchema, requestId);
  const actor = await requireCurrentActor();
  const reader = await repository.findReader(actor.id);
  const request = await repository.findRequestScope(id);

  if (!reader || !request) {
    throw new NotFoundError();
  }

  const audience = commentAudience(reader, request);
  return repository.listForRequest(id, audience === "attendant");
}

export interface CommentFileDownload {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

/**
 * Section 5.2: only someone who reads the comment downloads its file; a file of an internal note
 * is "not found" for the requester, and so is a file removed by an anonymization.
 */
export async function getCommentFileDownload(
  input: unknown,
  repository: CommentRepository,
  storage: Pick<CommentFileStorage, "get">,
): Promise<CommentFileDownload> {
  const { requestId, commentId, fileId } = validateInput(commentFileDownloadSchema, input);
  const actor = await requireCurrentActor();
  const reader = await repository.findReader(actor.id);
  const request = await repository.findRequestScope(requestId);

  if (!reader || !request) {
    throw new NotFoundError();
  }

  const audience = commentAudience(reader, request);
  const file = await repository.findFile(requestId, commentId, fileId);

  if (!file || file.removed || !canSeeComment(audience, file.isInternal)) {
    throw new NotFoundError();
  }

  return { bytes: await storage.get(file.storageKey), contentType: file.contentType, filename: file.originalFilename };
}

/**
 * Comment counts for lists the reader already sees (section 5.5). Requesters never count
 * internal notes.
 */
export async function countComments(
  requestIds: string[],
  repository: CommentRepository,
): Promise<Map<string, number>> {
  const actor = await requireCurrentActor();
  const ids = requestIds.map((id) => validateInput(entityIdSchema, id));

  return repository.countForRequests(ids, actor.role === "ATTENDANT");
}

/**
 * SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 1: the colleagues an attendant may mention in a note on this request,
 * the other active attendants of its sector, by name. Anyone who does not write internal notes on it gets none.
 */
export async function listMentionableColleagues(
  requestId: unknown,
  repository: CommentRepository,
): Promise<Array<{ id: string; name: string }>> {
  const id = validateInput(entityIdSchema, requestId);
  const actor = await requireCurrentActor();
  const reader = await repository.findReader(actor.id);
  const request = await repository.findRequestScope(id);
  if (!reader || !request || reader.role !== "ATTENDANT" || !reader.isActive || reader.sectorId !== request.sectorId) return [];
  const colleagues = repository.listMentionable ? await repository.listMentionable(request.sectorId) : [];
  return colleagues.filter((colleague) => colleague.id !== reader.id);
}
