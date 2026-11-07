import { z } from "zod";
import { entityIdSchema, nonEmptyTextSchema } from "@/shared/validation";
import { SERVICE_FIELD_AUDIENCES, SERVICE_FIELD_LIMITS, SERVICE_FIELD_TYPES, hasOptions } from "../domain/service-field";
import {
  MAX_DECIMAL_PLACES,
  MIN_DECIMAL_PLACES,
  decimalWithinBound,
  formatScaledDecimal,
  parseDecimal,
} from "../domain/decimal";

// SPEC 2026-11-01-campos-personalizados, sections 5.1 and 5.2. Service, position and state
// never come from input.

const limitSchema = z
  .number()
  .int()
  .min(-SERVICE_FIELD_LIMITS.integerBound)
  .max(SERVICE_FIELD_LIMITS.integerBound)
  .nullable();

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1. Optional with a null default, so
// callers written before the decimal type keep working.
const decimalPlacesSchema = z.number().int().min(MIN_DECIMAL_PLACES).max(MAX_DECIMAL_PLACES).nullable().default(null);
const decimalLimitSchema = z
  .string()
  .trim()
  .nullable()
  .default(null)
  .transform((value) => (value === "" ? null : value));

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
    decimalPlaces: decimalPlacesSchema,
    minDecimal: decimalLimitSchema,
    maxDecimal: decimalLimitSchema,
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
    checkDecimalConfiguration(field, context);
    // A condition has a controller and a value, or neither (5.2.1).
    if (field.conditionFieldId !== undefined && (field.conditionFieldId === null) !== !field.conditionValue) {
      context.addIssue({ code: "custom", path: ["conditionValue"], message: "A condition needs a field and a value." });
    }
  })
  // Decimal limits are stored with exactly the field's places ("10" with 2 places is "10.00").
  .transform((field) => ({
    ...field,
    minDecimal: normalizedLimit(field.minDecimal, field.decimalPlaces),
    maxDecimal: normalizedLimit(field.maxDecimal, field.decimalPlaces),
  }));

function normalizedLimit(value: string | null, places: number | null): string | null {
  const parsed = value === null || places === null ? null : parseDecimal(value);
  return parsed && places !== null ? formatScaledDecimal(parsed.scaled, places) : null;
}

/**
 * Section 3.3.1: places only on decimal fields and required on them; limits only on decimal
 * fields, written with at most the field's places, within ±1,000,000,000 and with min <= max.
 */
function checkDecimalConfiguration(
  field: { type: string; decimalPlaces: number | null; minDecimal: string | null; maxDecimal: string | null },
  context: z.RefinementCtx,
): void {
  if (field.type !== "DECIMAL") {
    if (field.decimalPlaces !== null || field.minDecimal !== null || field.maxDecimal !== null) {
      context.addIssue({ code: "custom", path: ["decimalPlaces"], message: "Only decimal fields have places and decimal limits." });
    }
    return;
  }

  if (field.decimalPlaces === null) {
    context.addIssue({ code: "custom", path: ["decimalPlaces"], message: "A decimal field needs its places." });
    return;
  }

  const places = field.decimalPlaces;
  const limits = (["minDecimal", "maxDecimal"] as const).map((key) => {
    const text = field[key];
    if (text === null) return null;
    const parsed = parseDecimal(text);
    if (!parsed || parsed.places > places || !decimalWithinBound(parsed.scaled)) {
      context.addIssue({ code: "custom", path: [key], message: "Invalid decimal limit." });
      return null;
    }
    return parsed.scaled;
  });

  if (limits[0] !== null && limits[1] !== null && limits[0] > limits[1]) {
    context.addIssue({ code: "custom", path: ["minDecimal"], message: "The minimum exceeds the maximum." });
  }
}

export const serviceFieldMoveSchema = z.enum(["up", "down"]);

export type ServiceFieldInput = z.output<typeof serviceFieldInputSchema>;
