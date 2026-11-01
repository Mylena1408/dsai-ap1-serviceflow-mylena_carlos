import { ValidationError } from "@/server/errors";
import { SERVICE_FIELD_LIMITS, type ServiceFieldRecord } from "./service-field";

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
  | "invalid_choice";

export type FieldValueResult =
  | { ok: true; value: string | null }
  | { ok: false; code: FieldValueErrorCode };

export type AnswerableField = Pick<
  ServiceFieldRecord,
  "id" | "label" | "type" | "isRequired" | "options" | "minValue" | "maxValue" | "position"
>;

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

// Validates one submitted answer. A blank optional field gives `value: null` (no answer is stored).
export function normalizeFieldValue(field: AnswerableField, raw: string | null | undefined): FieldValueResult {
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
  }
}

function compareFields(left: AnswerableField, right: AnswerableField): number {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

// Builds the answers of an opening from the service's active fields, as loaded from the database
// when the form is submitted (5.3.2). `submitted` maps field id to the raw value sent by the form.
export function collectFieldAnswers(
  activeFields: readonly AnswerableField[],
  submitted: ReadonlyMap<string, string>,
): FieldAnswersResult {
  const activeIds = new Set(activeFields.map((field) => field.id));

  if ([...submitted.keys()].some((fieldId) => !activeIds.has(fieldId))) {
    return { ok: false, reason: "stale_form" };
  }

  const answers: FieldAnswer[] = [];
  const errors: FieldAnswerError[] = [];

  [...activeFields].sort(compareFields).forEach((field, position) => {
    const result = normalizeFieldValue(field, submitted.get(field.id));

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
// as "Sim"/"Não", integers with Brazilian digit grouping; text as typed.
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
    default:
      return value;
  }
}
