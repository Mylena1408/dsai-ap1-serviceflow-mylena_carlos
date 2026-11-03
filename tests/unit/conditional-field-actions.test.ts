import { describe, expect, it } from "vitest";
import { serviceFieldFailure, serviceFieldFields } from "@/app/(admin)/admin/_shared/action-helpers";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.7 (SF-134).

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const base = { label: "Carregador", helpText: "", type: "SHORT_TEXT", isRequired: "false", options: "", minValue: "", maxValue: "" };
const fieldId = "11111111-1111-4111-8111-111111111111";

describe("custom field form with audience and condition", () => {
  it("sends audience and condition only when the form has them", () => {
    expect(serviceFieldFields(formData(base))).not.toHaveProperty("audience");
    expect(serviceFieldFields(formData(base))).not.toHaveProperty("conditionFieldId");
    expect(serviceFieldFields(formData({ ...base, audience: "ATTENDANT", condition: `${fieldId}::Notebook::A` }))).toMatchObject({
      audience: "ATTENDANT",
      conditionFieldId: fieldId,
      conditionValue: "Notebook::A",
    });
    expect(serviceFieldFields(formData({ ...base, condition: "" }))).toMatchObject({ conditionFieldId: null, conditionValue: null });
  });

  it("gives fixed messages for a broken condition and for a conflict", () => {
    expect(serviceFieldFailure(new ValidationError([{ path: ["conditionValue"], code: "invalid_value" }]))?.message).toContain("Escolha uma condição válida");
    expect(serviceFieldFailure(new ConflictError())?.message).toContain("quebraria a condição de outro campo");
    expect(serviceFieldFailure(new ConflictError(), "create")).toBeNull();
    expect(serviceFieldFailure(new ValidationError([{ path: ["label"], code: "too_big" }]))).toBeNull();
    expect(serviceFieldFailure(new NotFoundError())).toBeNull();
  });
});
