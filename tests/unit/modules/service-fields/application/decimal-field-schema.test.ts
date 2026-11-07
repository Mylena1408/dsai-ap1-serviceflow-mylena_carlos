import { describe, expect, it } from "vitest";
import { serviceFieldInputSchema } from "@/modules/service-fields/application/service-field-schemas";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1 (SF-161; rules of CA-CMP-01).

const base = {
  label: "Valor estimado",
  helpText: null,
  type: "DECIMAL",
  isRequired: false,
  options: [],
  minValue: null,
  maxValue: null,
};

function parse(overrides: Record<string, unknown>) {
  return serviceFieldInputSchema.safeParse({ ...base, ...overrides });
}

function issuePaths(overrides: Record<string, unknown>) {
  const result = parse(overrides);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("decimal field configuration (SF-161)", () => {
  it("accepts 1 to 4 places and stores the limits with exactly those places", () => {
    expect(parse({ decimalPlaces: 2, minDecimal: "0", maxDecimal: "1500,5" })).toMatchObject({
      success: true,
      data: { decimalPlaces: 2, minDecimal: "0.00", maxDecimal: "1500.50" },
    });
    expect(parse({ decimalPlaces: 1 })).toMatchObject({ success: true, data: { minDecimal: null, maxDecimal: null } });
    expect(parse({ decimalPlaces: 4, minDecimal: "-1000000000" })).toMatchObject({
      success: true,
      data: { minDecimal: "-1000000000.0000" },
    });
  });

  it("treats blank limits as no limit", () => {
    expect(parse({ decimalPlaces: 2, minDecimal: " ", maxDecimal: "" })).toMatchObject({
      success: true,
      data: { minDecimal: null, maxDecimal: null },
    });
  });

  it("requires the places on a decimal field and refuses values outside 1 to 4", () => {
    expect(issuePaths({})).toEqual(["decimalPlaces"]);
    expect(issuePaths({ decimalPlaces: 0 })).toContain("decimalPlaces");
    expect(issuePaths({ decimalPlaces: 5 })).toContain("decimalPlaces");
    expect(issuePaths({ decimalPlaces: 1.5 })).toContain("decimalPlaces");
  });

  it("refuses limits with more places than the field, outside the bound, not numbers, or inverted", () => {
    expect(issuePaths({ decimalPlaces: 2, minDecimal: "0,001" })).toEqual(["minDecimal"]);
    expect(issuePaths({ decimalPlaces: 2, maxDecimal: "1000000000,01" })).toEqual(["maxDecimal"]);
    expect(issuePaths({ decimalPlaces: 2, maxDecimal: "1.000,00" })).toEqual(["maxDecimal"]);
    expect(issuePaths({ decimalPlaces: 2, minDecimal: "10", maxDecimal: "9,99" })).toEqual(["minDecimal"]);
    expect(issuePaths({ decimalPlaces: 2, minDecimal: "10", maxDecimal: "10" })).toEqual([]);
  });

  it("refuses places and decimal limits on other types, and integer limits on decimals", () => {
    expect(issuePaths({ type: "INTEGER", decimalPlaces: 2 })).toEqual(["decimalPlaces"]);
    expect(issuePaths({ type: "SHORT_TEXT", maxDecimal: "1" })).toEqual(["decimalPlaces"]);
    expect(issuePaths({ decimalPlaces: 2, minValue: 1 })).toEqual(["minValue"]);
  });

  it("accepts the formatted types without options, limits or places", () => {
    for (const type of ["EMAIL", "PHONE", "CPF", "CNPJ", "CEP"]) {
      expect(parse({ type }).success, type).toBe(true);
      expect(issuePaths({ type, options: ["A", "B"] }), type).toEqual(["options"]);
    }
  });

  it("keeps old callers valid: without the new keys a non-decimal field gets nulls", () => {
    expect(parse({ type: "SHORT_TEXT" })).toMatchObject({
      success: true,
      data: { decimalPlaces: null, minDecimal: null, maxDecimal: null },
    });
  });
});
