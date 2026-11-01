import { z } from "zod";
import { entityIdSchema, nameSchema, nonEmptyTextSchema } from "@/shared/validation";

export const serviceInputSchema = z
  .object({
    name: nameSchema,
    description: nonEmptyTextSchema,
    categoryId: entityIdSchema,
    sectorId: entityIdSchema,
    // Optional so forms and callers without these fields keep the current values.
    defaultPriority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    slaHours: z.union([z.string(), z.number(), z.null()]).optional(),
  })
  .strict();

export type ServiceInput = z.output<typeof serviceInputSchema>;
