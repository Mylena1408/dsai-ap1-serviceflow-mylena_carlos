import { z } from "zod";
import { entityIdSchema, nonEmptyTextSchema } from "@/shared/validation";
import { SERVICE_FIELD_AUDIENCES, SERVICE_FIELD_LIMITS, SERVICE_FIELD_TYPES, hasOptions } from "../domain/service-field";

// SPEC 2026-11-01-campos-personalizados, sections 5.1 and 5.2. Service, position and state
// never come from input.

const limitSchema = z
  .number()
  .int()
  .min(-SERVICE_FIELD_LIMITS.integerBound)
  .max(SERVICE_FIELD_LIMITS.integerBound)
  .nullable();

export const serviceFieldTypeSchema = z.enum(SERVICE_FIELD_TYPES);

export const serviceFieldInputSchema = z
  .object({
    label: nonEmptyTextSchema.max(SERVICE_FIELD_LIMITS.label),
    // A blank help text means "no help text".
    helpText: z
      .string()
      .trim()
      .max(SERVICE_FIELD_LIMITS.helpText)
      .nullable()
      .transform((value) => (value === "" ? null : value)),
    type: serviceFieldTypeSchema,
    isRequired: z.boolean(),
    options: z.array(nonEmptyTextSchema.max(SERVICE_FIELD_LIMITS.option)),
    minValue: limitSchema,
    maxValue: limitSchema,
    // SPEC 2026-11-03-campos-condicionais-atendimento, 5.2 and 5.4. Optional so callers without
    // them keep the current values (create: requester, no condition).
    audience: z.enum(SERVICE_FIELD_AUDIENCES).optional(),
    conditionFieldId: entityIdSchema.nullable().optional(),
    conditionValue: z.string().trim().max(SERVICE_FIELD_LIMITS.option).nullable().optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (hasOptions(field.type)) {
      if (field.options.length < SERVICE_FIELD_LIMITS.minOptions || field.options.length > SERVICE_FIELD_LIMITS.maxOptions) {
        context.addIssue({ code: "custom", path: ["options"], message: "A list needs 2 to 20 options." });
      }
      if (new Set(field.options.map((option) => option.toLowerCase())).size !== field.options.length) {
        context.addIssue({ code: "custom", path: ["options"], message: "Options must not repeat." });
      }
    } else if (field.options.length > 0) {
      context.addIssue({ code: "custom", path: ["options"], message: "Only list fields have options." });
    }

    if (field.type !== "INTEGER" && (field.minValue !== null || field.maxValue !== null)) {
      context.addIssue({ code: "custom", path: ["minValue"], message: "Only integer fields have limits." });
    }
    if (field.minValue !== null && field.maxValue !== null && field.minValue > field.maxValue) {
      context.addIssue({ code: "custom", path: ["minValue"], message: "The minimum exceeds the maximum." });
    }
    // A condition has a controller and a value, or neither (5.2.1).
    if (field.conditionFieldId !== undefined && (field.conditionFieldId === null) !== !field.conditionValue) {
      context.addIssue({ code: "custom", path: ["conditionValue"], message: "A condition needs a field and a value." });
    }
  });

export const serviceFieldMoveSchema = z.enum(["up", "down"]);

export type ServiceFieldInput = z.output<typeof serviceFieldInputSchema>;
