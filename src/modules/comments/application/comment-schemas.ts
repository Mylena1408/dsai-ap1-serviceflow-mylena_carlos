import { z } from "zod";
import { entityIdSchema } from "@/shared/validation";

// Only the name and the bytes come from the form; every stored field of a file is derived on the
// server (SPEC 2026-11-03-anexos-comentarios-documentos, 5.1).
const commentFileUploadSchema = z
  .object({
    name: z.string(),
    bytes: z.instanceof(Uint8Array),
  })
  .strict();

// The text is trimmed and limited by the domain (normalizeCommentBody), with fixed messages.
export const commentInputSchema = z
  .object({
    requestId: entityIdSchema,
    body: z.string(),
    isInternal: z.boolean().default(false),
    files: z.array(commentFileUploadSchema).optional(),
  })
  .strict();

export const commentFileDownloadSchema = z
  .object({ requestId: entityIdSchema, commentId: entityIdSchema, fileId: entityIdSchema })
  .strict();
