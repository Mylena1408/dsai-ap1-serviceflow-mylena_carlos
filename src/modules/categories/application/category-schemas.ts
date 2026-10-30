import { z } from "zod";
import { nameSchema } from "@/shared/validation";

export const categoryInputSchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type CategoryInput = z.output<typeof categoryInputSchema>;
