// Public API of the custom fields module (SPEC 2026-11-01-campos-personalizados).
// SF-071 exposes the rules; the use cases and the repository come with SF-072 and SF-073.

export {
  MAX_ACTIVE_SERVICE_FIELDS,
  SERVICE_FIELD_LIMITS,
  SERVICE_FIELD_TYPES,
  assertCanAddActiveField,
  assertFieldTypeUnchanged,
} from "./domain/service-field";
export type { ServiceFieldDefinition, ServiceFieldRecord, ServiceFieldType } from "./domain/service-field";
export { collectFieldAnswers, normalizeFieldValue } from "./domain/field-value";
export type {
  AnswerableField,
  FieldAnswer,
  FieldAnswerError,
  FieldAnswersResult,
  FieldValueErrorCode,
  FieldValueResult,
} from "./domain/field-value";
export { serviceFieldInputSchema } from "./application/service-field-schemas";
export type { ServiceFieldInput } from "./application/service-field-schemas";
