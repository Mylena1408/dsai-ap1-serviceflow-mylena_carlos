// Fields with a validated format (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.2):
// e-mail, Brazilian phone, CPF, CNPJ and CEP. Each one is normalized for storage (digits only,
// or the lowercase address) and formatted again for display.

export const FORMATTED_FIELD_TYPES = ["EMAIL", "PHONE", "CPF", "CNPJ", "CEP"] as const;

export type FormattedFieldType = (typeof FORMATTED_FIELD_TYPES)[number];

export const EMAIL_MAX_LENGTH = 254;

/** Punctuation a person may type around digits: spaces, dots, hyphens, slashes and parentheses. */
const DIGIT_PUNCTUATION = /[\s.\-/()]/g;

/** The digits of `text` once the usual punctuation is removed, or null if anything else is left. */
function onlyDigits(text: string): string | null {
  const digits = text.replace(DIGIT_PUNCTUATION, "");
  return /^\d+$/.test(digits) ? digits : null;
}

function allSame(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

/** Check digit of the CPF/CNPJ rule: weighted sum modulo 11. */
function checkDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || allSame(digits)) {
    return false;
  }

  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);

  return first === Number(digits[9]) && second === Number(digits[10]);
}

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || allSame(digits)) {
    return false;
  }

  const first = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return first === Number(digits[12]) && second === Number(digits[13]);
}

/**
 * One "@", no spaces, a local part and a domain with a dot whose labels are not empty. This is a
 * plausibility check, not a delivery check: nothing is sent to the address.
 */
export function normalizeEmail(text: string): string | null {
  if ([...text].length > EMAIL_MAX_LENGTH || /\s/.test(text)) {
    return null;
  }

  const parts = text.split("@");

  if (parts.length !== 2) {
    return null;
  }

  const [local, domain] = parts;
  const labels = domain.split(".");

  if (local === "" || labels.length < 2 || labels.some((label) => label === "")) {
    return null;
  }

  return text.toLowerCase();
}

/**
 * 10 digits (landline) or 11 (mobile) with an area code from 11 to 99. A leading "+55" is the
 * country code and is dropped; "55" without the "+" is read as the area code 55.
 */
export function normalizePhone(text: string): string | null {
  const withoutCountry = text.trim().replace(/^\+\s*55/, "");
  const digits = onlyDigits(withoutCountry);

  if (!digits || (digits.length !== 10 && digits.length !== 11) || Number(digits.slice(0, 2)) < 11) {
    return null;
  }

  return digits;
}

export function normalizeCpf(text: string): string | null {
  const digits = onlyDigits(text);
  return digits && isValidCpf(digits) ? digits : null;
}

export function normalizeCnpj(text: string): string | null {
  const digits = onlyDigits(text);
  return digits && isValidCnpj(digits) ? digits : null;
}

export function normalizeCep(text: string): string | null {
  const digits = onlyDigits(text);
  return digits && digits.length === 8 ? digits : null;
}

const NORMALIZERS: Record<FormattedFieldType, (text: string) => string | null> = {
  EMAIL: normalizeEmail,
  PHONE: normalizePhone,
  CPF: normalizeCpf,
  CNPJ: normalizeCnpj,
  CEP: normalizeCep,
};

export function normalizeFormattedValue(type: FormattedFieldType, text: string): string | null {
  return NORMALIZERS[type](text);
}

/** Display of a stored value (3.3.2); a value that does not have the stored shape is unchanged. */
export function formatFormattedValue(type: FormattedFieldType, value: string): string {
  switch (type) {
    case "EMAIL":
      return value;
    case "PHONE":
      if (/^\d{11}$/.test(value)) return `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
      if (/^\d{10}$/.test(value)) return `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
      return value;
    case "CPF":
      return /^\d{11}$/.test(value) ? `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}` : value;
    case "CNPJ":
      return /^\d{14}$/.test(value)
        ? `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`
        : value;
    case "CEP":
      return /^\d{8}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
  }
}

export function isFormattedFieldType(type: string): type is FormattedFieldType {
  return (FORMATTED_FIELD_TYPES as readonly string[]).includes(type);
}
