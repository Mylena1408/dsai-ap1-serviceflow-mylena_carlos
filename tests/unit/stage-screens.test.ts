import { describe, expect, it } from "vitest";
import { parseSearchCriteria, parseStageFilter } from "@/modules/requests/domain/search-criteria";
import { hasSearchCriteria, searchPageHref } from "@/app/_components/request-search-url";
import { serviceStageSettingsFailure, serviceStageSettingsFields } from "@/app/(admin)/admin/_shared/action-helpers";
import { stageSettingsSummary } from "@/app/(admin)/admin/service-stages-editor";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3 and 5.3.4 (SF-170).

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("queue filter by stage (SF-170)", () => {
  it("reads empty as no filter, '__none__' as 'Sem etapa' and other values as a stage name", () => {
    expect(parseStageFilter(undefined)).toBeNull();
    expect(parseStageFilter("  ")).toBeNull();
    expect(parseStageFilter("__none__")).toEqual({ kind: "none" });
    expect(parseStageFilter(" Bancada ")).toEqual({ kind: "name", name: "Bancada" });
    expect(() => parseStageFilter("x".repeat(61))).toThrow(ValidationError);
  });

  it("is part of the queue's criteria only", () => {
    expect(parseSearchCriteria({ stage: "Bancada" }, "attendant").stage).toEqual({ kind: "name", name: "Bancada" });
    expect(parseSearchCriteria({ stage: "Bancada" }, "requester").stage).toBeUndefined();
    expect(parseSearchCriteria({}, "attendant")).not.toHaveProperty("stage");
  });

  it("stays in the address of the pages and counts as a criterion", () => {
    expect(searchPageHref("/queue", { stage: "Bancada", order: "oldest" }, 2)).toBe("/queue?stage=Bancada&order=oldest&page=2");
    expect(hasSearchCriteria({ stage: "__none__" })).toBe(true);
    expect(hasSearchCriteria({ stage: "" })).toBe(false);
  });
});

describe("stage settings form (SF-170)", () => {
  it("reads the attendant, the days and the condition, with blanks as none", () => {
    expect(serviceStageSettingsFields(formData({ assigneeId: "", targetDays: "", condition: "" }))).toEqual({
      assigneeId: null,
      targetDays: null,
      conditionFieldId: null,
      conditionValue: null,
    });
    expect(serviceStageSettingsFields(formData({ assigneeId: "bia", targetDays: "3", condition: "kind::Hardware" }))).toEqual({
      assigneeId: "bia",
      targetDays: 3,
      conditionFieldId: "kind",
      conditionValue: "Hardware",
    });
    expect(serviceStageSettingsFields(formData({ targetDays: "três" }))).toMatchObject({ targetDays: "três" });
  });

  it("gives fixed messages for each refusal", () => {
    const failure = (path: string) => serviceStageSettingsFailure(new ValidationError([{ path: [path], code: "custom" }]))?.message;
    expect(failure("assigneeId")).toContain("atendente ativo do setor");
    expect(failure("targetDays")).toContain("de 1 a 30 dias");
    expect(failure("conditionValue")).toContain("condição válida");
    expect(failure("name")).toBeUndefined();
    expect(serviceStageSettingsFailure(new Error("x"))).toBeNull();
  });

  it("summarizes the settings of a stage on one line", () => {
    const conditions = [{ fieldId: "kind", label: "Tipo", type: "SELECT" as const, options: ["Hardware", "Software"] }];
    expect(
      stageSettingsSummary(
        { id: "s", name: "Bancada", isActive: true, assigneeId: "bia", targetDays: 2, conditionFieldId: "kind", conditionValue: "Hardware" },
        [{ id: "bia", name: "Bia" }],
        conditions,
      ),
    ).toBe("Responsável: Bia · Prazo: 2 dias · Só quando Tipo = Hardware");
    expect(stageSettingsSummary({ id: "s", name: "Triagem", isActive: true, targetDays: 1 }, [], conditions)).toBe("Prazo: 1 dia");
    expect(stageSettingsSummary({ id: "s", name: "Testes", isActive: true, assigneeId: "gone" }, [], conditions)).toBe("Responsável: atendente indisponível");
    expect(stageSettingsSummary({ id: "s", name: "Fim", isActive: true }, [], conditions)).toBeNull();
  });
});
