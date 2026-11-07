import { ValidationError } from "@/server/errors";
import { SERVICE_FIELD_LIMITS, type ServiceFieldRecord } from "./service-field";
import { decimalWithinBound, formatDecimalForDisplay, formatScaledDecimal, parseDecimal } from "./decimal";
import { formatFormattedValue, isFormattedFieldType, normalizeFormattedValue } from "./formatted-values";

// SPEC 2026-11-01-campos-personalizados, sections 5.2 to 5.4: validation and normalization
// of the answers given on opening. Lengths count characters (code points), like PostgreSQL.

export type FieldValueErrorCode =
  | "required"
  | "too_long"
  | "line_break"
  | "not_integer"
  | "out_of_range"
  | "invalid_date"
  | "invalid_option"
  | "invalid_choice"
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1 and 3.3.2.
  | "not_decimal"
  | "too_many_decimals"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_cpf"
  | "invalid_cnpj"
  | "invalid_cep";

export type FieldValueResult =
  | { ok: true; value: string | null }
  | { ok: false; code: FieldValueErrorCode };

export type AnswerableField = Pick<
  ServiceFieldRecord,
  | "id"
  | "label"
  | "type"
  | "isRequired"
  | "options"
  | "minValue"
  | "maxValue"
  | "decimalPlaces"
  | "minDecimal"
  | "maxDecimal"
  | "position"
> &
  // SPEC 2026-11-03-campos-condicionais-atendimento, 5.2; optional so callers without conditions stay valid.
  Partial<Pick<ServiceFieldRecord, "conditionFieldId" | "conditionValue">>;

/** A submitted value: one text, or several for a multiple choice (5.1). */
export type SubmittedFieldValue = string | readonly string[];

export interface FieldAnswer {
  fieldId: string;
  labelSnapshot: string;
  typeSnapshot: ServiceFieldRecord["type"];
  positionSnapshot: number;
  value: string;
}

export interface FieldAnswerError {
  fieldId: string;
  code: FieldValueErrorCode;
}

export type FieldAnswersResult =
  | { ok: true; answers: FieldAnswer[] }
  // An answer for a field that is not active on the service: the form is out of date (5.3.3).
  | { ok: false; reason: "stale_form" }
  | { ok: false; reason: "invalid"; errors: FieldAnswerError[] };

const INTEGER_PATTERN = /^-?\d+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function characterCount(value: string): number {
  return [...value].length;
}

function valid(value: string | null): FieldValueResult {
  return { ok: true, value };
}

function invalid(code: FieldValueErrorCode): FieldValueResult {
  return { ok: false, code };
}

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function integerValue(field: AnswerableField, text: string): FieldValueResult {
  if (!INTEGER_PATTERN.test(text)) {
    return invalid("not_integer");
  }

  const number = Number(text);
  const lowest = field.minValue ?? -SERVICE_FIELD_LIMITS.integerBound;
  const highest = field.maxValue ?? SERVICE_FIELD_LIMITS.integerBound;

  if (number < lowest || number > highest) {
    return invalid("out_of_range");
  }

  // Base 10 without leading zeros; String(-0) is "0".
  return valid(String(number));
}

/**
 * Section 3.3.1 of SPEC 2026-11-06-aprofundamento-configurabilidade: comma or dot, at most the
 * configured places (never rounded), within the limits; stored with exactly those places.
 */
function decimalValue(field: AnswerableField, text: string): FieldValueResult {
  const parsed = parseDecimal(text);

  if (!parsed || field.decimalPlaces === null) {
    return invalid("not_decimal");
  }

  if (parsed.places > field.decimalPlaces) {
    return invalid("too_many_decimals");
  }

  const lowest = field.minDecimal === null ? null : parseDecimal(field.minDecimal);
  const highest = field.maxDecimal === null ? null : parseDecimal(field.maxDecimal);

  if (
    !decimalWithinBound(parsed.scaled) ||
    (lowest !== null && parsed.scaled < lowest.scaled) ||
    (highest !== null && parsed.scaled > highest.scaled)
  ) {
    return invalid("out_of_range");
  }

  return valid(formatScaledDecimal(parsed.scaled, field.decimalPlaces));
}

const FORMAT_ERRORS = {
  EMAIL: "invalid_email",
  PHONE: "invalid_phone",
  CPF: "invalid_cpf",
  CNPJ: "invalid_cnpj",
  CEP: "invalid_cep",
} as const satisfies Record<string, FieldValueErrorCode>;

function dateValue(text: string): FieldValueResult {
  if (!isCalendarDate(text)) {
    return invalid("invalid_date");
  }

  // ISO dates compare correctly as text.
  if (text < SERVICE_FIELD_LIMITS.firstDate || text > SERVICE_FIELD_LIMITS.lastDate) {
    return invalid("out_of_range");
  }

  return valid(text);
}

/**
 * Multiple choice (SPEC 2026-11-03-campos-condicionais-atendimento, 5.1): one or more current
 * options without repetition, stored as a JSON list in the configured order.
 */
function multipleChoiceValue(field: AnswerableField, raw: SubmittedFieldValue | null | undefined): FieldValueResult {
  const chosen = (typeof raw === "string" ? [raw] : [...(raw ?? [])]).map((value) => value.trim()).filter((value) => value !== "");

  if (chosen.length === 0) {
    return field.isRequired ? invalid("required") : valid(null);
  }

  if (new Set(chosen).size !== chosen.length || chosen.some((value) => !field.options.includes(value))) {
    return invalid("invalid_option");
  }

  return valid(JSON.stringify(field.options.filter((option) => chosen.includes(option))));
}

/** The options of a stored multiple-choice answer; empty when it is not a JSON list of texts. */
export function multipleChoiceOptions(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

// Validates one submitted answer. A blank optional field gives `value: null` (no answer is stored).
export function normalizeFieldValue(field: AnswerableField, submitted: SubmittedFieldValue | null | undefined): FieldValueResult {
  if (field.type === "MULTI_SELECT") {
    return multipleChoiceValue(field, submitted);
  }

  // Only a multiple choice takes several values (5.1).
  let raw: string | null | undefined;
  if (typeof submitted === "string" || submitted === null || submitted === undefined) {
    raw = submitted;
  } else if (submitted.length > 1) {
    return invalid("invalid_option");
  } else {
    raw = submitted[0];
  }

  // Browsers send textarea line breaks as CRLF; they count as one character.
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();

  if (text === "") {
    return field.isRequired ? invalid("required") : valid(null);
  }

  switch (field.type) {
    case "SHORT_TEXT":
      if (text.includes("\n")) {
        return invalid("line_break");
      }
      return characterCount(text) > SERVICE_FIELD_LIMITS.shortText ? invalid("too_long") : valid(text);
    case "LONG_TEXT":
      return characterCount(text) > SERVICE_FIELD_LIMITS.longText ? invalid("too_long") : valid(text);
    case "INTEGER":
      return integerValue(field, text);
    case "DATE":
      return dateValue(text);
    case "SELECT":
      return field.options.includes(text) ? valid(text) : invalid("invalid_option");
    case "YES_NO":
      return text === "true" || text === "false" ? valid(text) : invalid("invalid_choice");
    case "DECIMAL":
      return decimalValue(field, text);
    case "EMAIL":
    case "PHONE":
    case "CPF":
    case "CNPJ":
    case "CEP": {
      const normalized = normalizeFormattedValue(field.type, text);
      return normalized === null ? invalid(FORMAT_ERRORS[field.type]) : valid(normalized);
    }
  }
}

/**
 * Section 5.2.4: met when the controller's answer equals the value (list, yes or no) or contains it
 * (multiple choice). A field without condition is always shown; without an answer, not met.
 */
export function conditionMet(
  field: AnswerableField,
  controllerAnswer: { type: ServiceFieldRecord["type"]; value: string } | undefined,
): boolean {
  if (!field.conditionFieldId || field.conditionValue === null || field.conditionValue === undefined) {
    return true;
  }

  if (!controllerAnswer) {
    return false;
  }

  return controllerAnswer.type === "MULTI_SELECT"
    ? multipleChoiceOptions(controllerAnswer.value).includes(field.conditionValue)
    : controllerAnswer.value === field.conditionValue;
}

function compareFields(left: AnswerableField, right: AnswerableField): number {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

// Builds the answers of an opening from the service's active fields, as loaded from the database
// when the form is submitted (5.3.2). `submitted` maps field id to the raw value sent by the form.
// A field whose condition is not met is not required, and a value sent for it is discarded
// (SPEC 2026-11-03-campos-condicionais-atendimento, 5.2.5). Controllers have no condition, so
// they are decided first.
export function collectFieldAnswers(
  activeFields: readonly AnswerableField[],
  submitted: ReadonlyMap<string, SubmittedFieldValue>,
): FieldAnswersResult {
  const activeIds = new Set(activeFields.map((field) => field.id));

  if ([...submitted.keys()].some((fieldId) => !activeIds.has(fieldId))) {
    return { ok: false, reason: "stale_form" };
  }

  const ordered = [...activeFields].sort(compareFields);
  const results = new Map<string, FieldValueResult>();

  for (const field of ordered.filter((item) => !item.conditionFieldId)) {
    results.set(field.id, normalizeFieldValue(field, submitted.get(field.id)));
  }

  for (const field of ordered.filter((item) => item.conditionFieldId)) {
    const controller = ordered.find((item) => item.id === field.conditionFieldId);
    const controllerResult = controller ? results.get(controller.id) : undefined;
    const controllerAnswer =
      controller && controllerResult?.ok && controllerResult.value !== null
        ? { type: controller.type, value: controllerResult.value }
        : undefined;

    results.set(field.id, conditionMet(field, controllerAnswer) ? normalizeFieldValue(field, submitted.get(field.id)) : valid(null));
  }

  const answers: FieldAnswer[] = [];
  const errors: FieldAnswerError[] = [];

  ordered.forEach((field, position) => {
    const result = results.get(field.id)!;

    if (!result.ok) {
      errors.push({ fieldId: field.id, code: result.code });
    } else if (result.value !== null) {
      answers.push({
        fieldId: field.id,
        labelSnapshot: field.label,
        typeSnapshot: field.type,
        positionSnapshot: position,
        value: result.value,
      });
    }
  });

  return errors.length > 0 ? { ok: false, reason: "invalid", errors } : { ok: true, answers };
}

/**
 * Section 5.5.4: labels of the required active fields, with the condition met, still without an
 * answer. The completion is refused while the list is not empty.
 */
export function missingRequiredFields(
  activeFields: readonly AnswerableField[],
  answers: ReadonlyMap<string, { type: ServiceFieldRecord["type"]; value: string }>,
): string[] {
  return [...activeFields]
    .sort(compareFields)
    .filter((field) => field.isRequired && !answers.has(field.id))
    .filter((field) => conditionMet(field, field.conditionFieldId ? answers.get(field.conditionFieldId) : undefined))
    .map((field) => field.label);
}

// Refused answers of an opening. Field ids and fixed codes are safe to show: they let the form
// point at each field without echoing what was typed (section 5.3.4).
export class FieldAnswersError extends ValidationError {
  constructor(
    readonly reason: "stale_form" | "invalid",
    readonly fieldErrors: readonly FieldAnswerError[] = [],
  ) {
    super([{ path: ["fields"], code: "custom" }]);
  }
}

export function assertFieldAnswers(result: FieldAnswersResult): FieldAnswer[] {
  if (result.ok) {
    return result.answers;
  }

  throw result.reason === "stale_form"
    ? new FieldAnswersError("stale_form")
    : new FieldAnswersError("invalid", result.errors);
}

// How an answer is shown in the request details (section 5.4.3): dates as DD/MM/AAAA, yes/no
// as "Sim"/"Não", integers and decimals with Brazilian digit grouping, formatted types with their
// punctuation (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3); text as typed.
export function formatFieldAnswer(type: ServiceFieldRecord["type"], value: string): string {
  switch (type) {
    case "DATE": {
      const match = DATE_PATTERN.exec(value);
      return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
    }
    case "YES_NO":
      return value === "true" ? "Sim" : value === "false" ? "Não" : value;
    case "INTEGER":
      return INTEGER_PATTERN.test(value) ? Number(value).toLocaleString("pt-BR") : value;
    case "MULTI_SELECT": {
      const options = multipleChoiceOptions(value);
      return options.length > 0 ? options.join(", ") : value;
    }
    case "DECIMAL":
      return formatDecimalForDisplay(value);
    default:
      return isFormattedFieldType(type) ? formatFormattedValue(type, value) : value;
  }
}
