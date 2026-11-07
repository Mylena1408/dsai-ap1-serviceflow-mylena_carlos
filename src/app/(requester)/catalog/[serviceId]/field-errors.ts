import type { FieldValueErrorCode } from "@/modules/service-fields";
import type { FieldErrorCode } from "./request-form";

// Field errors sent back by an opening action (SPEC 2026-11-01-campos-personalizados, 5.3.4): a
// "fields" list of "<fieldId>.<code>" pairs. Shared by the opening of a service and of a bundle
// (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3).

// A record with every code, so a code added to FieldErrorCode without an entry here fails to compile
// (the codes of SPEC 2026-11-06-aprofundamento-configurabilidade were missing from the old list).
const KNOWN_FIELD_ERROR_CODES: Record<FieldErrorCode, true> = {
  required: true,
  too_long: true,
  line_break: true,
  not_integer: true,
  out_of_range: true,
  invalid_date: true,
  invalid_option: true,
  invalid_choice: true,
  not_decimal: true,
  too_many_decimals: true,
  invalid_email: true,
  invalid_phone: true,
  invalid_cpf: true,
  invalid_cnpj: true,
  invalid_cep: true,
};
const FIELD_ERROR_CODES = new Set(Object.keys(KNOWN_FIELD_ERROR_CODES));

// The form's codes are the domain's codes, in both directions.
type SameCodes = [FieldValueErrorCode] extends [FieldErrorCode] ? ([FieldErrorCode] extends [FieldValueErrorCode] ? true : never) : never;
const formCodesMatchDomain: SameCodes = true;
void formCodesMatchDomain;

/** Anything that does not name an active field with a known code is ignored. */
export function parseFieldErrors(list: string | undefined, fieldIds: ReadonlySet<string>): Record<string, FieldErrorCode> {
  const errors: Record<string, FieldErrorCode> = {};

  for (const item of (list ?? "").split(",")) {
    const separator = item.lastIndexOf(".");
    const fieldId = item.slice(0, separator);
    const code = item.slice(separator + 1) as FieldErrorCode;
    if (separator > 0 && fieldIds.has(fieldId) && FIELD_ERROR_CODES.has(code)) errors[fieldId] = code;
  }

  return errors;
}
