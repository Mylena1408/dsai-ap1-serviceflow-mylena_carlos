import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-01-campos-personalizados, sections 5.1, 5.2 and 6.

// "MULTI_SELECT" added by SPEC 2026-11-03-campos-condicionais-atendimento, 5.1; "DECIMAL" and the
// formatted types by SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.
export const SERVICE_FIELD_TYPES = [
  "SHORT_TEXT",
  "LONG_TEXT",
  "INTEGER",
  "DATE",
  "SELECT",
  "YES_NO",
  "MULTI_SELECT",
  "DECIMAL",
  "EMAIL",
  "PHONE",
  "CPF",
  "CNPJ",
  "CEP",
] as const;

export type ServiceFieldType = (typeof SERVICE_FIELD_TYPES)[number];

/** Who fills the field (SPEC 2026-11-03-campos-condicionais-atendimento, 5.4). */
export const SERVICE_FIELD_AUDIENCES = ["REQUESTER", "ATTENDANT"] as const;

export type ServiceFieldAudience = (typeof SERVICE_FIELD_AUDIENCES)[number];

/** Types with a list of options. */
export function hasOptions(type: ServiceFieldType): boolean {
  return type === "SELECT" || type === "MULTI_SELECT";
}

/** Types that may control a condition (5.2.2). */
export const CONDITION_CONTROLLER_TYPES: readonly ServiceFieldType[] = ["SELECT", "YES_NO", "MULTI_SELECT"];

// Decision F4: at most ten active fields per service.
export const MAX_ACTIVE_SERVICE_FIELDS = 10;

export const SERVICE_FIELD_LIMITS = {
  label: 80,
  helpText: 200,
  minOptions: 2,
  maxOptions: 20,
  option: 80,
  integerBound: 1_000_000_000,
  shortText: 200,
  longText: 2_000,
  firstDate: "1900-01-01",
  lastDate: "2100-12-31",
} as const;

export interface ServiceFieldDefinition {
  label: string;
  helpText: string | null;
  type: ServiceFieldType;
  isRequired: boolean;
  // Only list fields have options; only integer fields have limits.
  options: string[];
  minValue: number | null;
  maxValue: number | null;
  /**
   * Only decimal fields (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1): 1 to 4 places,
   * required on them; the limits are text with exactly those places ("10.50"), or null.
   */
  decimalPlaces: number | null;
  minDecimal: string | null;
  maxDecimal: string | null;
  /** SPEC 2026-11-03-campos-condicionais-atendimento, 5.2 and 5.4. */
  audience: ServiceFieldAudience;
  conditionFieldId: string | null;
  conditionValue: string | null;
}

export interface ServiceFieldRecord extends ServiceFieldDefinition {
  id: string;
  serviceId: string;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function assertCanAddActiveField(activeFieldCount: number): void {
  if (activeFieldCount >= MAX_ACTIVE_SERVICE_FIELDS) {
    throw new ConflictError();
  }
}

// Section 5.1: the type never changes; the administrator deactivates the field and creates another.
export function assertFieldTypeUnchanged(current: ServiceFieldType, requested: ServiceFieldType): void {
  if (current !== requested) {
    throw new ConflictError();
  }
}

// Conditions and their integrity (SPEC 2026-11-03-campos-condicionais-atendimento, 5.2 and 5.3).

export type ConditionController = Pick<
  ServiceFieldRecord,
  "id" | "type" | "options" | "audience" | "isActive" | "conditionFieldId"
>;

/**
 * Section 5.2 items 2 and 3: an active field of the same service (the caller loads it from the
 * service) and audience, of a type with choices, without its own condition, and not the field
 * itself; the value is one of its options, or "true"/"false". Refusals name the field.
 */
export function assertConditionTarget(
  field: { id: string | null; audience: ServiceFieldAudience },
  controller: ConditionController | null,
  value: string,
): void {
  if (
    !controller ||
    controller.id === field.id ||
    !controller.isActive ||
    controller.audience !== field.audience ||
    !CONDITION_CONTROLLER_TYPES.includes(controller.type) ||
    controller.conditionFieldId !== null
  ) {
    throw new ValidationError([{ path: ["conditionFieldId"], code: "invalid_value" }]);
  }

  const accepted = controller.type === "YES_NO" ? ["true", "false"] : controller.options;

  if (!accepted.includes(value)) {
    throw new ValidationError([{ path: ["conditionValue"], code: "invalid_value" }]);
  }
}

/** Section 5.3 item 4: a controller of an active field does not get a condition itself. */
export function assertNotControllerOfActiveFields(activeDependents: number, conditionFieldId: string | null): void {
  if (conditionFieldId !== null && activeDependents > 0) {
    throw new ConflictError();
  }
}

/** Section 5.3 item 1: a controller of an active field is not deactivated. */
export function assertCanDeactivateController(activeDependents: number): void {
  if (activeDependents > 0) {
    throw new ConflictError();
  }
}

/** Section 5.3 item 2: the options keep every value used by an active condition. */
export function assertOptionsKeepConditions(
  type: ServiceFieldType,
  options: readonly string[],
  usedValues: readonly string[],
): void {
  if (hasOptions(type) && usedValues.some((value) => !options.includes(value))) {
    throw new ConflictError();
  }
}

/** Section 5.3 item 3: a field whose controller is inactive is not reactivated. */
export function assertConditionControllerActive(controller: { isActive: boolean } | null, conditionFieldId: string | null): void {
  if (conditionFieldId !== null && !controller?.isActive) {
    throw new ConflictError();
  }
}
