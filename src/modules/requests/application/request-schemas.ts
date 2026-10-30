import { z } from "zod";
import { entityIdSchema, nonEmptyTextSchema } from "@/shared/validation";

export const requestCreationInputSchema = z
  .object({
    serviceId: entityIdSchema,
    description: nonEmptyTextSchema.max(10_000),
  })
  .strict();

export const requestStatusTransitionInputSchema = z
  .object({
    requestId: entityIdSchema,
    toStatus: z.enum(["IN_PROGRESS", "COMPLETED"]),
  })
  .strict();

export type RequestCreationInput = z.output<typeof requestCreationInputSchema>;
export type RequestStatusTransitionInput = z.output<
  typeof requestStatusTransitionInputSchema
>;
