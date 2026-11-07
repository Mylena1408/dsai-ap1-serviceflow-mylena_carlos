import { z } from "zod";
import { entityIdSchema } from "@/shared/validation";

// Opening a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3, decision H3): one description
// for every request and the answers of each service's form. Field ids are unique across services,
// so the answers arrive in one map and are split by the fields each service has now.

export const bundleOpeningInputSchema = z
  .object({
    bundleId: entityIdSchema,
    description: z.string().trim().min(1).max(10_000),
    // The bounds of a single opening (only stop abuse), for up to 5 services of 50 fields each. A
    // multiple choice takes a list (SPEC 2026-11-03-campos-condicionais-atendimento, 5.1).
    fieldValues: z
      .record(z.string().max(64), z.union([z.string().max(20_000), z.array(z.string().max(200)).max(20)]))
      .refine((values) => Object.keys(values).length <= 250, { message: "Too many field values." })
      .optional(),
  })
  .strict();

export type BundleOpeningInput = z.output<typeof bundleOpeningInputSchema>;

/** The answers that belong to one service: only its active fields. */
export function answersOf(
  fieldValues: Readonly<Record<string, string | string[]>>,
  fieldIds: ReadonlySet<string>,
): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(fieldValues).filter(([fieldId]) => fieldIds.has(fieldId)));
}

/** Answers to fields no service of the bundle has: the form was built with another configuration. */
export function strayAnswers(fieldValues: Readonly<Record<string, unknown>>, fieldIds: ReadonlySet<string>): string[] {
  return Object.keys(fieldValues).filter((fieldId) => !fieldIds.has(fieldId));
}
