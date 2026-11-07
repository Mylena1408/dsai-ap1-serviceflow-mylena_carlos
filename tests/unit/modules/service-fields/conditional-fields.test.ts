import { describe, expect, it } from "vitest";
import {
  collectFieldAnswers,
  conditionMet,
  formatFieldAnswer,
  missingRequiredFields,
  normalizeFieldValue,
  type AnswerableField,
} from "@/modules/service-fields/domain/field-value";
import {
  assertCanDeactivateController,
  assertConditionControllerActive,
  assertConditionTarget,
  assertNotControllerOfActiveFields,
  assertOptionsKeepConditions,
  type ConditionController,
} from "@/modules/service-fields/domain/service-field";
import { serviceFieldInputSchema } from "@/modules/service-fields/application/service-field-schemas";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.1 to 5.3 and 5.5.4 (SF-133).

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function field(overrides: Partial<AnswerableField> = {}): AnswerableField {
  return {
    id: id(1),
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

const devices = field({ id: id(1), label: "Equipamentos", type: "MULTI_SELECT", options: ["Mouse", "Teclado", "Monitor"], isRequired: true });

describe("multiple choice (5.1)", () => {
  it("keeps the chosen options in the configured order, as a JSON list", () => {
    expect(normalizeFieldValue(devices, ["Monitor", " Mouse "])).toEqual({ ok: true, value: '["Mouse","Monitor"]' });
    expect(normalizeFieldValue(devices, "Teclado")).toEqual({ ok: true, value: '["Teclado"]' });
    expect(formatFieldAnswer("MULTI_SELECT", '["Mouse","Monitor"]')).toBe("Mouse, Monitor");
  });

  it("refuses none on a required field, unknown and repeated options", () => {
    expect(normalizeFieldValue(devices, [])).toEqual({ ok: false, code: "required" });
    expect(normalizeFieldValue(devices, ["  "])).toEqual({ ok: false, code: "required" });
    expect(normalizeFieldValue({ ...devices, isRequired: false }, [])).toEqual({ ok: true, value: null });
    expect(normalizeFieldValue(devices, ["Mouse", "Impressora"])).toEqual({ ok: false, code: "invalid_option" });
    expect(normalizeFieldValue(devices, ["Mouse", "Mouse"])).toEqual({ ok: false, code: "invalid_option" });
  });

  it("takes only one value on the other types", () => {
    const shift = field({ type: "SELECT", options: ["Manhã", "Tarde"] });
    expect(normalizeFieldValue(shift, ["Tarde"])).toEqual({ ok: true, value: "Tarde" });
    expect(normalizeFieldValue(shift, ["Manhã", "Tarde"])).toEqual({ ok: false, code: "invalid_option" });
  });
});

describe("conditions on the answers (5.2)", () => {
  const kind = field({ id: id(1), label: "Tipo", type: "SELECT", options: ["Notebook", "Desktop"], isRequired: true, position: 0 });
  const charger = field({ id: id(2), label: "Carregador", isRequired: true, position: 1, conditionFieldId: id(1), conditionValue: "Notebook" });
  const monitor = field({ id: id(3), label: "Qual monitor", isRequired: true, position: 2, conditionFieldId: id(4), conditionValue: "Monitor" });
  const multi = { ...devices, id: id(4), position: 3, isRequired: false };

  it("asks for a conditional field only when the controller has the value", () => {
    const shown = collectFieldAnswers([kind, charger], new Map([[id(1), "Notebook"]]));
    expect(shown).toEqual({ ok: false, reason: "invalid", errors: [{ fieldId: id(2), code: "required" }] });

    const hidden = collectFieldAnswers([kind, charger], new Map([[id(1), "Desktop"], [id(2), "65 W"]]));
    // The value sent for the hidden field is discarded, without error (5.2.5).
    expect(hidden).toEqual({
      ok: true,
      answers: [{ fieldId: id(1), labelSnapshot: "Tipo", typeSnapshot: "SELECT", positionSnapshot: 0, value: "Desktop" }],
    });
  });

  it("uses 'contains' for a multiple-choice controller and keeps the order of the snapshot", () => {
    const result = collectFieldAnswers([kind, charger, monitor, multi], new Map<string, string | string[]>([[id(1), "Desktop"], [id(4), ["Monitor"]], [id(3), "LG 24"]]));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.answers.map(({ labelSnapshot, positionSnapshot }) => [labelSnapshot, positionSnapshot])).toEqual([
      ["Tipo", 0],
      ["Qual monitor", 2],
      ["Equipamentos", 3],
    ]);
  });

  it("does not show a conditional field when the controller is unanswered or invalid", () => {
    expect(conditionMet(charger, undefined)).toBe(false);
    expect(conditionMet(field(), undefined)).toBe(true);
    const invalidController = collectFieldAnswers([kind, charger], new Map([[id(1), "Tablet"], [id(2), ""]]));
    expect(invalidController).toEqual({ ok: false, reason: "invalid", errors: [{ fieldId: id(1), code: "invalid_option" }] });
    expect(conditionMet({ ...charger, conditionValue: "true" }, { type: "YES_NO", value: "true" })).toBe(true);
  });
});

describe("required attendance fields at completion (5.5.4)", () => {
  it("lists the required fields with the condition met and no answer", () => {
    const order = field({ id: id(1), label: "Ordem de serviço", isRequired: true, position: 0 });
    const replaced = field({ id: id(2), label: "Peça trocada?", type: "YES_NO", isRequired: true, position: 1 });
    const part = field({ id: id(3), label: "Qual peça", isRequired: true, position: 2, conditionFieldId: id(2), conditionValue: "true" });
    const note = field({ id: id(4), label: "Observação", position: 3 });

    expect(missingRequiredFields([order, replaced, part, note], new Map())).toEqual(["Ordem de serviço", "Peça trocada?"]);
    expect(missingRequiredFields([order, replaced, part, note], new Map([[id(2), { type: "YES_NO" as const, value: "true" }]]))).toEqual([
      "Ordem de serviço",
      "Qual peça",
    ]);
    expect(
      missingRequiredFields(
        [order, replaced, part],
        new Map([
          [id(1), { type: "SHORT_TEXT" as const, value: "OS-1" }],
          [id(2), { type: "YES_NO" as const, value: "false" }],
        ]),
      ),
    ).toEqual([]);
  });
});

describe("configuration rules of conditions (5.2 and 5.3)", () => {
  const controller: ConditionController = {
    id: id(1),
    type: "SELECT",
    options: ["Notebook", "Desktop"],
    audience: "REQUESTER",
    isActive: true,
    conditionFieldId: null,
  };
  const target = { id: id(2), audience: "REQUESTER" as const };

  it("accepts an active controller with choices of the same audience and one of its values", () => {
    expect(() => assertConditionTarget(target, controller, "Notebook")).not.toThrow();
    expect(() => assertConditionTarget(target, { ...controller, type: "YES_NO", options: [] }, "false")).not.toThrow();
    expect(() => assertConditionTarget({ id: null, audience: "REQUESTER" }, controller, "Desktop")).not.toThrow();
  });

  it("refuses other controllers on conditionFieldId and other values on conditionValue", () => {
    const path = (run: () => void) => {
      try {
        run();
      } catch (error) {
        return error instanceof ValidationError ? error.issues[0]?.path[0] : "other";
      }
      return null;
    };
    for (const bad of [
      null,
      { ...controller, id: id(2) },
      { ...controller, isActive: false },
      { ...controller, audience: "ATTENDANT" as const },
      { ...controller, type: "SHORT_TEXT" as const },
      { ...controller, conditionFieldId: id(9) },
    ]) {
      expect(path(() => assertConditionTarget(target, bad, "Notebook")), JSON.stringify(bad)).toBe("conditionFieldId");
    }
    expect(path(() => assertConditionTarget(target, controller, "Tablet"))).toBe("conditionValue");
    expect(path(() => assertConditionTarget(target, { ...controller, type: "YES_NO", options: [] }, "Sim"))).toBe("conditionValue");
  });

  it("refuses the changes that would break a condition with a conflict", () => {
    expect(() => assertCanDeactivateController(1)).toThrow(ConflictError);
    expect(() => assertCanDeactivateController(0)).not.toThrow();
    expect(() => assertOptionsKeepConditions("SELECT", ["Desktop"], ["Notebook"])).toThrow(ConflictError);
    expect(() => assertOptionsKeepConditions("SELECT", ["Notebook", "Tablet"], ["Notebook"])).not.toThrow();
    expect(() => assertConditionControllerActive({ isActive: false }, id(1))).toThrow(ConflictError);
    expect(() => assertConditionControllerActive(null, null)).not.toThrow();
    expect(() => assertNotControllerOfActiveFields(1, id(1))).toThrow(ConflictError);
    expect(() => assertNotControllerOfActiveFields(1, null)).not.toThrow();
  });

  it("validates the input of a field with a multiple choice, an audience and a condition", () => {
    const base = { label: "Equipamentos", helpText: null, type: "MULTI_SELECT", isRequired: true, options: ["A", "B"], minValue: null, maxValue: null };
    expect(serviceFieldInputSchema.safeParse({ ...base, audience: "ATTENDANT", conditionFieldId: id(1), conditionValue: "Sim" }).success).toBe(true);
    expect(serviceFieldInputSchema.safeParse({ ...base, options: ["A"] }).success).toBe(false);
    expect(serviceFieldInputSchema.safeParse({ ...base, conditionFieldId: id(1), conditionValue: "" }).success).toBe(false);
    expect(serviceFieldInputSchema.safeParse({ ...base, conditionFieldId: null, conditionValue: "A" }).success).toBe(false);
    expect(serviceFieldInputSchema.safeParse({ ...base, audience: "MANAGER" }).success).toBe(false);
  });
});
