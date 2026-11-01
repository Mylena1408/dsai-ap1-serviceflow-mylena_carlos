import type { RequestStatus } from "@/modules/requests";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// Comment rules (SPEC 2026-10-31-comentarios, section 5). Callers load reader and request
// from the database; these functions only decide.

export const MAX_COMMENT_LENGTH = 5_000;

export interface CommentReader {
  id: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorId: string | null;
}

export interface CommentRequestScope {
  requesterId: string;
  sectorId: string;
  status: RequestStatus;
}

/** Who is reading: decides whether internal notes are visible (section 5.1). */
export type CommentAudience = "requester" | "attendant";

/**
 * Section 5.1: the requester who opened the request or an active attendant of its current
 * sector. Everyone else gets "not found", so the request is not revealed.
 */
export function commentAudience(reader: CommentReader, request: CommentRequestScope): CommentAudience {
  if (reader.isActive && reader.role === "REQUESTER" && reader.id === request.requesterId) {
    return "requester";
  }

  if (reader.isActive && reader.role === "ATTENDANT" && reader.sectorId === request.sectorId) {
    return "attendant";
  }

  throw new NotFoundError();
}

/** Section 5.1 (decision C3): internal notes are for attendants only. */
export function canSeeComment(audience: CommentAudience, isInternal: boolean): boolean {
  return audience === "attendant" || !isInternal;
}

/** Trims the text and enforces 1 to 5,000 characters (section 5.3). */
export function normalizeCommentBody(raw: string): string {
  const body = raw.trim();

  if (body === "") {
    throw new ValidationError([{ path: ["body"], code: "too_small" }]);
  }

  if ([...body].length > MAX_COMMENT_LENGTH) {
    throw new ValidationError([{ path: ["body"], code: "too_big" }]);
  }

  return body;
}

/**
 * Sections 5.1 and 5.2 (decision C1): open, in-progress and completed requests accept
 * comments; cancelled ones are read-only. Only attendants write internal notes.
 */
export function assertCanComment(
  reader: CommentReader,
  request: CommentRequestScope,
  isInternal: boolean,
): CommentAudience {
  const audience = commentAudience(reader, request);

  if (request.status === "CANCELLED") {
    throw new ConflictError();
  }

  if (isInternal && audience !== "attendant") {
    throw new ValidationError([{ path: ["isInternal"], code: "invalid_value" }]);
  }

  return audience;
}
