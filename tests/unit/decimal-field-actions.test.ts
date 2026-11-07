import { describe, expect, it } from "vitest";
import { serviceFieldFailure, serviceFieldFields } from "@/app/(admin)/admin/_shared/action-helpers";
import { serviceFieldInputSchema } from "@/modules/service-fields/application/service-field-schemas";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1 (SF-162; CA-CMP-01): the custom field form
// with a decimal field.

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const base = { label: "Valor", helpText: "", type: "DECIMAL", isRequired: "true", options: "", minValue: "", maxValue: "" };

describe("decimal field form (SF-162)", () => {
  it("sends the places as a number and the limits as typed, only when the form has them", () => {
    expect(serviceFieldFields(formData({ ...base, decimalPlaces: "2", minDecimal: " 0,5 ", maxDecimal: "" }))).toMatchObject({
      decimalPlaces: 2,
      minDecimal: "0,5",
      maxDecimal: "",
    });
    expect(serviceFieldFields(formData({ ...base, type: "CPF" }))).not.toHaveProperty("decimalPlaces");
    // Text that is not a whole number goes to validation as it is.
    expect(serviceFieldFields(formData({ ...base, decimalPlaces: "dois" }))).toMatchObject({ decimalPlaces: "dois" });
  });

  it("passes the form through the schema: comma limits become stored text, blanks become no limit", () => {
    const parsed = serviceFieldInputSchema.parse(
      serviceFieldFields(formData({ ...base, decimalPlaces: "2", minDecimal: "0,5", maxDecimal: "" })),
    );
    expect(parsed).toMatchObject({ type: "DECIMAL", decimalPlaces: 2, minDecimal: "0.50", maxDecimal: null });

    const cpf = serviceFieldInputSchema.parse(serviceFieldFields(formData({ ...base, type: "CPF" })));
    expect(cpf).toMatchObject({ type: "CPF", decimalPlaces: null, minDecimal: null, maxDecimal: null });
  });

  it("gives a fixed message for an invalid decimal configuration, on creation and on update", () => {
    for (const path of ["decimalPlaces", "minDecimal", "maxDecimal"]) {
      const error = new ValidationError([{ path: [path], code: "custom" }]);
      expect(serviceFieldFailure(error, "create")?.message).toContain("Revise o número decimal");
      expect(serviceFieldFailure(error)?.message).toContain("Revise o número decimal");
    }
    expect(serviceFieldFailure(new ValidationError([{ path: ["label"], code: "too_big" }]))).toBeNull();
  });
});
