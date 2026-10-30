import { z } from "zod";
import { entityIdSchema, nameSchema, nonEmptyTextSchema } from "@/shared/validation";

export const serviceInputSchema = z
  .object({
    name: nameSchema,
    description: nonEmptyTextSchema,
    categoryId: entityIdSchema,
    sectorId: entityIdSchema,
  })
  .strict();

export type ServiceInput = z.output<typeof serviceInputSchema>;
