import { z } from "zod";
import { entityIdSchema } from "@/shared/validation";

// The text is trimmed and limited by the domain (normalizeCommentBody), with fixed messages.
export const commentInputSchema = z
  .object({
    requestId: entityIdSchema,
    body: z.string(),
    isInternal: z.boolean().default(false),
  })
  .strict();
