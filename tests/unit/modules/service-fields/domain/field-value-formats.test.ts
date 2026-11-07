import { describe, expect, it } from "vitest";
import {
  collectFieldAnswers,
  formatFieldAnswer,
  normalizeFieldValue,
  type AnswerableField,
} from "@/modules/service-fields/domain/field-value";
import { CONDITION_CONTROLLER_TYPES } from "@/modules/service-fields/domain/service-field";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3 (SF-161): answers of the decimal and
// formatted types, through the same rules as the existing types.

function field(overrides: Partial<AnswerableField> = {}): AnswerableField {
  return {
    id: "field-1",
    label: "Campo",
    type: "SHORT_TEXT",
    isRequired: false,
    options: [],
    minValue: null,
    maxValue: null,
    decimalPlaces: null,
    minDecimal: null,
    maxDecimal: null,
    position: 0,
    ...overrides,
  };
}

const price = field({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "0.00", maxDecimal: "5000.00" });

describe("decimal answers (SF-161)", () => {
  it("accepts comma or dot and stores exactly the configured places", () => {
    expect(normalizeFieldValue(price, "1234,5")).toEqual({ ok: true, value: "1234.50" });
    expect(normalizeFieldValue(price, " 10.25 ")).toEqual({ ok: true, value: "10.25" });
    expect(normalizeFieldValue(price, "7")).toEqual({ ok: true, value: "7.00" });
  });

  it("refuses more places than configured instead of rounding", () => {
    expect(normalizeFieldValue(price, "10,255")).toEqual({ ok: false, code: "too_many_decimals" });
    expect(normalizeFieldValue(field({ type: "DECIMAL", decimalPlaces: 4 }), "1,23456")).toEqual({
      ok: false,
      code: "too_many_decimals",
    });
  });

  it("refuses text that is not a number and values outside the limits", () => {
    expect(normalizeFieldValue(price, "1.234,50")).toEqual({ ok: false, code: "not_decimal" });
    expect(normalizeFieldValue(price, "R$ 10")).toEqual({ ok: false, code: "not_decimal" });
    expect(normalizeFieldValue(price, "-0,01")).toEqual({ ok: false, code: "out_of_range" });
    expect(normalizeFieldValue(price, "5000,01")).toEqual({ ok: false, code: "out_of_range" });
    expect(normalizeFieldValue(price, "5000")).toEqual({ ok: true, value: "5000.00" });
  });

  it("uses ±1,000,000,000 when there are no limits", () => {
    const open = field({ type: "DECIMAL", decimalPlaces: 1 });
    expect(normalizeFieldValue(open, "-1000000000")).toEqual({ ok: true, value: "-1000000000.0" });
    expect(normalizeFieldValue(open, "1000000000,1")).toEqual({ ok: false, code: "out_of_range" });
  });

  it("refuses a decimal answer when the field has no places (inconsistent configuration)", () => {
    expect(normalizeFieldValue(field({ type: "DECIMAL" }), "1")).toEqual({ ok: false, code: "not_decimal" });
  });

  it("follows the blank and required rules of every type", () => {
    expect(normalizeFieldValue(price, "  ")).toEqual({ ok: true, value: null });
    expect(normalizeFieldValue({ ...price, isRequired: true }, "")).toEqual({ ok: false, code: "required" });
    expect(normalizeFieldValue(price, ["1", "2"])).toEqual({ ok: false, code: "invalid_option" });
  });
});

describe("formatted answers (SF-161)", () => {
  it.each([
    ["EMAIL", "Ana@Exemplo.com.br", "ana@exemplo.com.br"],
    ["PHONE", "(91) 98765-4321", "91987654321"],
    ["CPF", "529.982.247-25", "52998224725"],
    ["CNPJ", "11.222.333/0001-81", "11222333000181"],
    ["CEP", "66075-110", "66075110"],
  ] as const)("normalizes a valid %s", (type, typed, stored) => {
    expect(normalizeFieldValue(field({ type }), typed)).toEqual({ ok: true, value: stored });
  });

  it.each([
    ["EMAIL", "ana@exemplo", "invalid_email"],
    ["PHONE", "98765-4321", "invalid_phone"],
    ["CPF", "529.982.247-24", "invalid_cpf"],
    ["CPF", "111.111.111-11", "invalid_cpf"],
    ["CNPJ", "11.222.333/0001-80", "invalid_cnpj"],
    ["CEP", "6607-511", "invalid_cep"],
  ] as const)("refuses an invalid %s (%s) with a fixed code", (type, typed, code) => {
    expect(normalizeFieldValue(field({ type }), typed)).toEqual({ ok: false, code });
  });

  it("is shown formatted in the request details", () => {
    expect(formatFieldAnswer("DECIMAL", "1234.50")).toBe("1.234,50");
    expect(formatFieldAnswer("PHONE", "91987654321")).toBe("(91) 98765-4321");
    expect(formatFieldAnswer("CPF", "52998224725")).toBe("529.982.247-25");
    expect(formatFieldAnswer("CNPJ", "11222333000181")).toBe("11.222.333/0001-81");
    expect(formatFieldAnswer("CEP", "66075110")).toBe("66075-110");
    expect(formatFieldAnswer("EMAIL", "ana@exemplo.com.br")).toBe("ana@exemplo.com.br");
    // Existing types keep their display.
    expect(formatFieldAnswer("INTEGER", "1234")).toBe("1.234");
    expect(formatFieldAnswer("SHORT_TEXT", "529.982.247-25")).toBe("529.982.247-25");
  });

  it("does not let the new types control a condition", () => {
    for (const type of ["DECIMAL", "EMAIL", "PHONE", "CPF", "CNPJ", "CEP"] as const) {
      expect(CONDITION_CONTROLLER_TYPES).not.toContain(type);
    }
  });

  it("collects the new answers with the snapshot, and reports each refusal by field", () => {
    const fields = [
      field({ id: "cpf", label: "CPF", type: "CPF", isRequired: true, position: 0 }),
      field({ id: "valor", label: "Valor", type: "DECIMAL", decimalPlaces: 2, position: 1 }),
      field({ id: "cep", label: "CEP", type: "CEP", position: 2 }),
    ];

    expect(collectFieldAnswers(fields, new Map([["cpf", "529.982.247-25"], ["valor", "99,9"]]))).toEqual({
      ok: true,
      answers: [
        { fieldId: "cpf", labelSnapshot: "CPF", typeSnapshot: "CPF", positionSnapshot: 0, value: "52998224725" },
        { fieldId: "valor", labelSnapshot: "Valor", typeSnapshot: "DECIMAL", positionSnapshot: 1, value: "99.90" },
      ],
    });
    expect(collectFieldAnswers(fields, new Map([["cpf", "123"], ["cep", "1"]]))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { fieldId: "cpf", code: "invalid_cpf" },
        { fieldId: "cep", code: "invalid_cep" },
      ],
    });
  });
});
