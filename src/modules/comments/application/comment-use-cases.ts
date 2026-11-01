import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { assertCanComment, commentAudience, normalizeCommentBody } from "../domain/comment-policy";
import { commentInputSchema } from "./comment-schemas";
import type { CommentRecord, CommentRepository, CommentTransactionRunner } from "./ports";

// Comments on a request (SPEC 2026-10-31-comentarios). Every call reloads the reader and
// the request, so a sector change or deactivation applies immediately.

/** Sections 5.1 to 5.3: author and time come from the session and the database clock. */
export async function addComment(
  input: unknown,
  transactions: CommentTransactionRunner,
): Promise<CommentRecord> {
  const parsed = validateInput(commentInputSchema, input);
  const body = normalizeCommentBody(parsed.body);
  const actor = await requireCurrentActor();

  return transactions.run(async (transaction) => {
    const reader = await transaction.findReader(actor.id);
    const request = await transaction.findRequestScope(parsed.requestId);

    if (!reader || !request) {
      throw new NotFoundError();
    }

    assertCanComment(reader, request, parsed.isInternal);

    const comment = await transaction.insertComment({
      requestId: parsed.requestId,
      authorId: reader.id,
      body,
      isInternal: parsed.isInternal,
      createdAt: await transaction.currentTime(),
    });
    // Identifiers only: the text never goes to the outbox (SPEC de eventos, 6.1).
    await transaction.recordEvent({
      type: "request.comment_added",
      requestId: comment.requestId,
      occurredAt: comment.createdAt,
      payload: { commentId: comment.id, authorId: comment.author.id, isInternal: comment.isInternal },
    });

    return comment;
  });
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
