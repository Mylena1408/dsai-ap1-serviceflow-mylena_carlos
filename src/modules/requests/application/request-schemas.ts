import { z } from "zod";
import { entityIdSchema, nonEmptyTextSchema } from "@/shared/validation";

// The client only links each file to a requirement; name and bytes are inspected on the
// server and every stored attachment field is derived there (SPEC 21.4 item 8).
const attachmentUploadSchema = z
  .object({
    requirementId: entityIdSchema,
    name: z.string(),
    bytes: z.instanceof(Uint8Array),
  })
  .strict();

export const requestCreationInputSchema = z
  .object({
    serviceId: entityIdSchema,
    description: nonEmptyTextSchema.max(10_000),
    attachments: z.array(attachmentUploadSchema).optional(),
  })
  .strict();

export const requestStatusTransitionInputSchema = z
  .object({
    requestId: entityIdSchema,
    toStatus: z.enum(["IN_PROGRESS", "COMPLETED"]),
  })
  .strict();

export const requestAssignmentInputSchema = z
  .object({ requestId: entityIdSchema })
  .strict();

export const requestTransferInputSchema = z
  .object({ requestId: entityIdSchema, assigneeId: entityIdSchema })
  .strict();

// Reasons are trimmed and limited by the domain (normalizeNote), with fixed messages.
export const requestCancellationInputSchema = z
  .object({ requestId: entityIdSchema, note: z.string().optional() })
  .strict();

export const requestReopeningInputSchema = z
  .object({ requestId: entityIdSchema, note: z.string() })
  .strict();

export type RequestCreationInput = z.output<typeof requestCreationInputSchema>;
export type RequestStatusTransitionInput = z.output<
  typeof requestStatusTransitionInputSchema
>;
