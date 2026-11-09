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
    // SPEC 2026-11-01-aprovacoes, 5.2; optional for the same reason.
    requiresApproval: z.boolean().optional(),
    // SPEC 2026-11-03-pausa-sla-calendario, 5.2; optional for the same reason.
    slaBusinessHours: z.boolean().optional(),
    // SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 1; optional for the same reason.
    estimatedHours: z.union([z.string(), z.number(), z.null()]).optional(),
  })
  .strict();

export type ServiceInput = z.output<typeof serviceInputSchema>;

/**
 * Approval levels and condition (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1 and
 * 4.3.7). An empty list keeps one level, the service's sector; a condition has a field and a value,
 * or neither.
 */
export const serviceApprovalInputSchema = z
  .object({
    sectorIds: z.array(entityIdSchema).max(3),
    conditionFieldId: entityIdSchema.nullable(),
    conditionValue: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .transform((value) => (value === "" ? null : value)),
    // 4.3.6: days to decide each level; omitted keeps the current value, null removes it.
    deadlineDays: z.number().int().min(1).max(30).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.conditionFieldId === null) !== (input.conditionValue === null)) {
      context.addIssue({ code: "custom", path: ["conditionValue"], message: "A condition needs a field and a value." });
    }
  });

export type ServiceApprovalInput = z.output<typeof serviceApprovalInputSchema>;
