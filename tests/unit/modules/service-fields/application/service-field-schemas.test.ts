import { describe, expect, it } from "vitest";
import { serviceFieldInputSchema } from "@/modules/service-fields/application/service-field-schemas";
import {
  MAX_ACTIVE_SERVICE_FIELDS,
  assertCanAddActiveField,
  assertFieldTypeUnchanged,
} from "@/modules/service-fields/domain/service-field";
import { ConflictError } from "@/server/errors";

// SPEC 2026-11-01-campos-personalizados, sections 5.1 and 5.2 (SF-071; rules of CA-FLD-03).

const base = {
  label: "Número do patrimônio",
  helpText: null,
  type: "SHORT_TEXT",
  isRequired: true,
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

describe("serviceFieldInputSchema (SF-071)", () => {
  it("accepts a valid field and trims label and help text", () => {
    expect(parse({ label: "  Patrimônio  ", helpText: "  Etiqueta na lateral  " })).toMatchObject({
      success: true,
      data: { label: "Patrimônio", helpText: "Etiqueta na lateral" },
    });
  });

  it("turns a blank help text into no help text", () => {
    expect(parse({ helpText: "   " })).toMatchObject({ success: true, data: { helpText: null } });
  });

  it("limits the label to 1 to 80 characters and the help text to 200", () => {
    expect(parse({ label: "a".repeat(80) }).success).toBe(true);
    expect(issuePaths({ label: "a".repeat(81) })).toEqual(["label"]);
    expect(issuePaths({ label: "   " })).toEqual(["label"]);
    expect(parse({ helpText: "a".repeat(200) }).success).toBe(true);
    expect(issuePaths({ helpText: "a".repeat(201) })).toEqual(["helpText"]);
  });

  it("accepts only the six types", () => {
    for (const type of ["SHORT_TEXT", "LONG_TEXT", "INTEGER", "DATE", "YES_NO"]) {
      expect(parse({ type }).success).toBe(true);
    }
    expect(parse({ type: "SELECT", options: ["Sim", "Talvez"] }).success).toBe(true);
    expect(issuePaths({ type: "MULTI_SELECT" })).toEqual(["type"]);
  });

  it("requires 2 to 20 distinct options of up to 80 characters on list fields", () => {
    const options = (count: number) => Array.from({ length: count }, (_, index) => `Opção ${index + 1}`);

    expect(parse({ type: "SELECT", options: options(2) }).success).toBe(true);
    expect(parse({ type: "SELECT", options: options(20) }).success).toBe(true);
    expect(issuePaths({ type: "SELECT", options: options(1) })).toEqual(["options"]);
    expect(issuePaths({ type: "SELECT", options: options(21) })).toEqual(["options"]);
    expect(issuePaths({ type: "SELECT", options: ["Manhã", "MANHÃ"] })).toEqual(["options"]);
    expect(issuePaths({ type: "SELECT", options: ["Manhã", "a".repeat(81)] })).toEqual(["options.1"]);
    expect(issuePaths({ type: "SELECT", options: ["Manhã", "  "] })).toEqual(["options.1"]);
  });

  it("refuses options on fields that are not lists", () => {
    expect(issuePaths({ type: "SHORT_TEXT", options: ["a", "b"] })).toEqual(["options"]);
  });

  it("allows limits only on integer fields, within one billion and with min <= max", () => {
    expect(parse({ type: "INTEGER", minValue: 1, maxValue: 1 }).success).toBe(true);
    expect(parse({ type: "INTEGER", minValue: -1_000_000_000, maxValue: null }).success).toBe(true);
    expect(issuePaths({ type: "INTEGER", minValue: 2, maxValue: 1 })).toEqual(["minValue"]);
    expect(issuePaths({ type: "INTEGER", minValue: 1.5 })).toEqual(["minValue"]);
    expect(issuePaths({ type: "INTEGER", maxValue: 1_000_000_001 })).toEqual(["maxValue"]);
    expect(issuePaths({ type: "DATE", minValue: 1 })).toEqual(["minValue"]);
  });

  it("refuses service, position or state coming from input", () => {
    expect(issuePaths({ serviceId: "x", position: 0, isActive: true })).toEqual([""]);
  });
});

describe("field configuration rules (SF-071)", () => {
  it("allows at most ten active fields per service", () => {
    expect(MAX_ACTIVE_SERVICE_FIELDS).toBe(10);
    expect(() => assertCanAddActiveField(9)).not.toThrow();
    expect(() => assertCanAddActiveField(10)).toThrow(ConflictError);
  });

  it("never changes the type of an existing field", () => {
    expect(() => assertFieldTypeUnchanged("DATE", "DATE")).not.toThrow();
    expect(() => assertFieldTypeUnchanged("DATE", "SHORT_TEXT")).toThrow(ConflictError);
  });
});
