import { z } from "zod";
import { nonEmptyTextSchema } from "@/shared/validation";

export const documentFormatSchema = z.enum(["PDF", "DOCX", "TXT"]);

// SPEC 21.2: name up to 120 characters, required/optional flag and a non-empty
// subset of PDF, DOCX and TXT. Service, position and state never come from input.
export const documentRequirementInputSchema = z
  .object({
    name: nonEmptyTextSchema.max(120),
    isRequired: z.boolean(),
    acceptedFormats: z
      .array(documentFormatSchema)
      .min(1)
      .max(3)
      .refine((formats) => new Set(formats).size === formats.length, {
        message: "Accepted formats must not repeat.",
      }),
  })
  .strict();

export const documentRequirementMoveSchema = z.enum(["up", "down"]);

export type DocumentRequirementInput = z.output<typeof documentRequirementInputSchema>;
export type DocumentRequirementMove = z.output<typeof documentRequirementMoveSchema>;
