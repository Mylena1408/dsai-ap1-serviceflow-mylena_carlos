import { z } from "zod";
import { nameSchema } from "@/shared/validation";

export const sectorInputSchema = z
  .object({
    name: nameSchema,
  })
  .strict();

export type SectorInput = z.output<typeof sectorInputSchema>;
