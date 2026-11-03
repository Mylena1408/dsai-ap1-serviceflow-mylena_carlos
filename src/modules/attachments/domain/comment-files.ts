import { ValidationError } from "@/server/errors";
import { assertAttachmentBatchLimits, inspectAttachment, type AttachmentUpload, type InspectedAttachment } from "./attachment-policy";
import type { DetectedDocumentFormat } from "./file-type";

// Files attached to comments (SPEC 2026-11-03-anexos-comentarios-documentos, 5.1; decisions X1 and
// X2). Same file rules as the documents of section 21, with their own count limits.

export const MAX_FILES_PER_COMMENT = 3;
export const MAX_COMMENT_FILES_PER_REQUEST = 30;
export const COMMENT_FILE_FORMATS: readonly DetectedDocumentFormat[] = ["PDF", "DOCX", "TXT"];

/**
 * 5.1 items 2 and 3: up to 3 files, 2 MiB each and 4 MiB together, and at most 30 comment files
 * in the request counting the ones already there. Refusals use the "attachments" field, like the
 * documents of the opening.
 */
export function assertCommentFileLimits(uploads: ReadonlyArray<{ size: number }>, alreadyInRequest: number): void {
  if (uploads.length > MAX_FILES_PER_COMMENT || alreadyInRequest + uploads.length > MAX_COMMENT_FILES_PER_REQUEST) {
    throw new ValidationError([{ path: ["attachments"], code: "too_big" }]);
  }

  assertAttachmentBatchLimits([...uploads]);
}

/** One comment file, with every stored field derived on the server (section 21.7 and 21.9). */
export function inspectCommentFile(upload: AttachmentUpload): InspectedAttachment {
  return inspectAttachment(upload, COMMENT_FILE_FORMATS);
}
