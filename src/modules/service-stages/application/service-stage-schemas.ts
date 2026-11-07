import { z } from "zod";
import { entityIdSchema, nonEmptyTextSchema } from "@/shared/validation";
import { MAX_STAGE_NAME_LENGTH, MAX_STAGE_TARGET_DAYS, MIN_STAGE_TARGET_DAYS } from "../domain/service-stage";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.1: only the name comes from input; service,
// position and state are decided on the server.
export const serviceStageInputSchema = z
  .object({
    name: nonEmptyTextSchema.max(MAX_STAGE_NAME_LENGTH),
  })
  .strict();

export const serviceStageMoveSchema = z.enum(["up", "down"]);

export type ServiceStageInput = z.output<typeof serviceStageInputSchema>;

/**
 * Settings of a stage (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3): the attendant, the
 * target days and the condition, each optional; a condition has a field and a value, or neither.
 */
export const serviceStageSettingsSchema = z
  .object({
    assigneeId: entityIdSchema.nullable(),
    targetDays: z.number().int().min(MIN_STAGE_TARGET_DAYS).max(MAX_STAGE_TARGET_DAYS).nullable(),
    conditionFieldId: entityIdSchema.nullable(),
    conditionValue: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .transform((value) => (value === "" ? null : value)),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.conditionFieldId === null) !== (input.conditionValue === null)) {
      context.addIssue({ code: "custom", path: ["conditionValue"], message: "A condition needs a field and a value." });
    }
  });

export type ServiceStageSettings = z.output<typeof serviceStageSettingsSchema>;
