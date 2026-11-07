import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assertRulePeople,
  assertRuleRoom,
  escalationRuleCreateSchema,
  escalationRuleSettingsSchema,
  hasEffect,
  ruleEffectText,
  ruleTriggerText,
  sameCombination,
  type EscalationRuleRecord,
  type RulePerson,
} from "@/modules/sectors/domain/escalation-rule";
import type { EscalationRuleTransaction } from "@/modules/sectors/application/escalation-rules";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  createEscalationRule,
  deleteEscalationRule,
  setEscalationRuleActive,
  updateEscalationRule,
} from "@/modules/sectors/application/escalation-rules";
import { EscalationRulesPanel } from "@/app/(admin)/admin/_sections/sectors/escalation-rules-panel";
import { escalationRuleFailureEntity } from "@/app/(admin)/admin/_shared/action-helpers";
import { announcement } from "@/app/(admin)/admin/_shared/announcement";
import { auditValueFormatter } from "@/app/(admin)/admin/_sections/audit/audit-section";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 items 1 and 6 (SF-173; CA-ESR-02 by the rules).

const admin = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" as const, isActive: true, sectorId: null };
const sectorId = "11111111-1111-4111-8111-111111111111";
const ruleId = "22222222-2222-4222-8222-222222222222";
const bia = "33333333-3333-4333-8333-333333333333";
const gabi = "44444444-4444-4444-8444-444444444444";

const people: RulePerson[] = [
  { id: bia, role: "ATTENDANT", isActive: true, sectorId },
  { id: gabi, role: "MANAGER", isActive: true, sectorId },
];

const settings = {
  name: "Vencida há 3 dias",
  trigger: "OVERDUE_DAYS" as const,
  overdueDays: 3,
  raisePriority: true,
  assignToId: null,
  notifyManagers: false,
  notifyTeam: false,
  notifyUserIds: [] as string[],
};

const rule = (overrides: Partial<EscalationRuleRecord> = {}): EscalationRuleRecord => ({
  id: ruleId,
  sectorId,
  isActive: true,
  ...settings,
  ...overrides,
});

beforeEach(() => {
  authorization.requireConfigurationAdministrator.mockReset().mockResolvedValue(admin);
});

describe("rule settings (7.1 and 7.3 item 1)", () => {
  it("reads form values: blanks, flags and N", () => {
    expect(
      escalationRuleSettingsSchema.parse({
        name: " Atraso ",
        trigger: "OVERDUE_DAYS",
        overdueDays: "3",
        raisePriority: "true",
        assignToId: "",
        notifyManagers: false,
        notifyTeam: "on",
        notifyUserIds: [gabi],
      }),
    ).toEqual({ name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 3, raisePriority: true, assignToId: null, notifyManagers: false, notifyTeam: true, notifyUserIds: [gabi] });
    expect(escalationRuleSettingsSchema.parse({ name: "Perto", trigger: "DUE_SOON", overdueDays: "", notifyManagers: true })).toMatchObject({
      overdueDays: null,
      notifyUserIds: [],
      raisePriority: false,
    });
  });

  it("refuses N outside 1 to 30, N with 'próxima', no action, the option's trigger and repeated people", () => {
    const issuesOf = (input: object) => {
      const result = escalationRuleSettingsSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map(({ path }) => path.join("."));
    };
    expect(issuesOf({ ...settings, overdueDays: 0 })).toContain("overdueDays");
    expect(issuesOf({ ...settings, overdueDays: 31 })).toContain("overdueDays");
    expect(issuesOf({ ...settings, overdueDays: null })).toContain("overdueDays");
    expect(issuesOf({ ...settings, trigger: "DUE_SOON" })).toContain("overdueDays");
    expect(issuesOf({ ...settings, raisePriority: false })).toContain("actions");
    expect(issuesOf({ ...settings, trigger: "OVERDUE" })).toContain("trigger");
    expect(issuesOf({ ...settings, name: "" })).toContain("name");
    expect(issuesOf({ ...settings, name: "x".repeat(61) })).toContain("name");
    expect(issuesOf({ ...settings, notifyUserIds: [gabi, gabi] })).toContain("notifyUserIds");
    expect(issuesOf({ ...settings, notifyUserIds: Array.from({ length: 11 }, (_, index) => `${index}`.padStart(8, "0") + "-0000-4000-8000-000000000000") })).toContain(
      "notifyUserIds",
    );
    expect(escalationRuleCreateSchema.safeParse({ ...settings, sectorId: "x" }).success).toBe(false);
  });

  it("knows whether a rule does anything", () => {
    expect(hasEffect({ ...settings, raisePriority: false })).toBe(false);
    expect(hasEffect({ ...settings, raisePriority: false, notifyUserIds: [gabi] })).toBe(true);
    expect(hasEffect({ ...settings, raisePriority: false, assignToId: bia })).toBe(true);
  });

  it("names people of the sector only: attendants to assign, attendants and managers to warn", () => {
    expect(() => assertRulePeople(sectorId, { assignToId: bia, notifyUserIds: [gabi, bia] }, people)).not.toThrow();
    expect(() => assertRulePeople(sectorId, { assignToId: gabi, notifyUserIds: [] }, people)).toThrow(ValidationError);
    expect(() => assertRulePeople("other", { assignToId: bia, notifyUserIds: [] }, people)).toThrow(ValidationError);
    expect(() => assertRulePeople(sectorId, { assignToId: null, notifyUserIds: ["missing"] }, people)).toThrow(ValidationError);
    expect(() => assertRulePeople(sectorId, { assignToId: null, notifyUserIds: [bia] }, [{ ...people[0], isActive: false }])).toThrow(ValidationError);
  });

  it("allows up to 5 active rules and compares trigger and N", () => {
    expect(() => assertRuleRoom(4)).not.toThrow();
    expect(() => assertRuleRoom(5)).toThrow(ConflictError);
    expect(sameCombination({ trigger: "DUE_SOON", overdueDays: null }, { trigger: "DUE_SOON", overdueDays: null })).toBe(true);
    expect(sameCombination({ trigger: "OVERDUE_DAYS", overdueDays: 3 }, { trigger: "OVERDUE_DAYS", overdueDays: 5 })).toBe(false);
  });

  it("describes the trigger and the effect", () => {
    expect(ruleTriggerText({ trigger: "DUE_SOON", overdueDays: null })).toBe("Próxima do vencimento");
    expect(ruleTriggerText({ trigger: "OVERDUE_DAYS", overdueDays: 1 })).toBe("Vencida há 1 dia");
    expect(ruleTriggerText({ trigger: "OVERDUE_DAYS", overdueDays: 3 })).toBe("Vencida há 3 dias");
    expect(ruleEffectText({ ...settings, assignToId: bia, notifyManagers: true, notifyTeam: true, notifyUserIds: [gabi] }, { [bia]: "Bia", [gabi]: "Gabi" })).toBe(
      "Sobe a prioridade · Atribui a Bia · Avisa os gestores, a equipe e Gabi",
    );
    expect(ruleEffectText({ ...settings, raisePriority: false, notifyManagers: true }, {})).toBe("Avisa os gestores");
    expect(ruleEffectText({ ...settings, raisePriority: false, assignToId: bia }, {})).toBe("Atribui a atendente indisponível");
  });
});

function store(state: { rule?: EscalationRuleRecord | null; others?: EscalationRuleRecord[]; sector?: boolean } = {}) {
  const current = state.rule === undefined ? rule() : state.rule;
  const transaction: EscalationRuleTransaction = {
    audited: vi.fn(async (_meta, change) => change()),
    sectorExists: vi.fn(async () => state.sector ?? true),
    findRule: vi.fn(async () => current),
    activeRules: vi.fn(async () => state.others ?? []),
    findPeople: vi.fn(async () => people),
    createRule: vi.fn(async (sector, values) => ({ id: ruleId, sectorId: sector, isActive: true, ...values })),
    updateRule: vi.fn(async (_id, data) => ({ ...rule(), ...data })),
    deleteRule: vi.fn(async () => undefined),
  };
  return { transaction, runner: { run: <T>(work: (t: EscalationRuleTransaction) => Promise<T>) => work(transaction) } };
}

const other = (index: number, overrides: Partial<EscalationRuleRecord> = {}) =>
  rule({ id: `other-${index}`, name: `Regra ${index}`, overdueDays: 10 + index, ...overrides });

describe("rule use cases (7.3 items 1 and 6)", () => {
  it("only the administrator configures", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    const { runner, transaction } = store();
    await expect(createEscalationRule({ sectorId, ...settings }, runner)).rejects.toThrow(AuthorizationError);
    await expect(deleteEscalationRule(ruleId, runner)).rejects.toThrow(AuthorizationError);
    expect(transaction.createRule).not.toHaveBeenCalled();
  });

  it("creates with the audit trail after checking room, combination, name and people", async () => {
    const { runner, transaction } = store();
    await createEscalationRule({ sectorId, ...settings, assignToId: bia, notifyUserIds: [gabi] }, runner);
    expect(transaction.findPeople).toHaveBeenCalledWith([bia, gabi]);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATED", entityType: "ESCALATION_RULE" }), expect.any(Function));

    const full = store({ others: [1, 2, 3, 4, 5].map((index) => other(index)) });
    await expect(createEscalationRule({ sectorId, ...settings }, full.runner)).rejects.toThrow(ConflictError);
    const sameTrigger = store({ others: [other(1, { overdueDays: 3 })] });
    await expect(createEscalationRule({ sectorId, ...settings }, sameTrigger.runner)).rejects.toThrow(ConflictError);
    const sameName = store({ others: [other(1, { name: "VENCIDA HÁ 3 DIAS" })] });
    await expect(createEscalationRule({ sectorId, ...settings }, sameName.runner)).rejects.toThrow(ConflictError);
    await expect(createEscalationRule({ sectorId, ...settings }, store({ sector: false }).runner)).rejects.toThrow(NotFoundError);
    await expect(createEscalationRule({ sectorId, ...settings, assignToId: gabi }, store().runner)).rejects.toThrow(ValidationError);
  });

  it("edits leaving the rule itself out of the comparison", async () => {
    const { runner, transaction } = store();
    await updateEscalationRule(ruleId, { ...settings, notifyTeam: true }, runner);
    expect(transaction.activeRules).toHaveBeenCalledWith(sectorId, ruleId);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATED", entityId: ruleId }), expect.any(Function));
    await expect(updateEscalationRule(ruleId, settings, store({ rule: null }).runner)).rejects.toThrow(NotFoundError);

    const inactive = store({ rule: rule({ isActive: false }), others: [1, 2, 3, 4, 5].map((index) => other(index)) });
    await updateEscalationRule(ruleId, settings, inactive.runner);
    expect(inactive.transaction.activeRules).not.toHaveBeenCalled();
  });

  it("deactivates, reactivates within the limit and does nothing on the same state", async () => {
    const { runner, transaction } = store();
    await setEscalationRuleActive(ruleId, false, runner);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATED" }), expect.any(Function));

    const back = store({ rule: rule({ isActive: false }) });
    await setEscalationRuleActive(ruleId, true, back.runner);
    expect(back.transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "REACTIVATED" }), expect.any(Function));

    const full = store({ rule: rule({ isActive: false }), others: [1, 2, 3, 4, 5].map((index) => other(index)) });
    await expect(setEscalationRuleActive(ruleId, true, full.runner)).rejects.toThrow(ConflictError);
    const taken = store({ rule: rule({ isActive: false }), others: [other(1, { overdueDays: 3 })] });
    await expect(setEscalationRuleActive(ruleId, true, taken.runner)).rejects.toThrow(ConflictError);

    const same = store();
    await setEscalationRuleActive(ruleId, true, same.runner);
    expect(same.transaction.audited).not.toHaveBeenCalled();
  });

  it("deletes with the audit trail", async () => {
    const { runner, transaction } = store();
    await deleteEscalationRule(ruleId, runner);
    expect(transaction.deleteRule).toHaveBeenCalledWith(ruleId);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETED", entityId: ruleId }), expect.any(Function));
    await expect(deleteEscalationRule(ruleId, store({ rule: null }).runner)).rejects.toThrow(NotFoundError);
  });
});

describe("rules on the screens (7.3)", () => {
  it("lists rules with trigger and effect, the forms and the limit", () => {
    const choices = [
      { id: bia, name: "Bia", role: "ATTENDANT" as const, sectorId },
      { id: gabi, name: "Gabi", role: "MANAGER" as const, sectorId },
    ];
    const html = renderToStaticMarkup(
      createElement(EscalationRulesPanel, {
        sector: { id: sectorId, name: "TI" },
        rules: [rule({ assignToId: bia, notifyUserIds: [gabi] }), rule({ id: "r2", name: "Perto", trigger: "DUE_SOON", overdueDays: null, isActive: false })],
        people: choices,
        names: { [bia]: "Bia", [gabi]: "Gabi" },
      }),
    );
    expect(html).toContain('aria-label="Regras de escalonamento de TI"');
    expect(html).toContain("Vencida há 3 dias: Sobe a prioridade · Atribui a Bia · Avisa Gabi");
    expect(html).toContain(">Inativa<");
    expect(html).toContain(">Criar regra<");
    // Only attendants are offered to receive the requests.
    expect(html).toContain('<option value="33333333-3333-4333-8333-333333333333">Bia</option>');
    expect(html).not.toContain('<option value="44444444-4444-4444-8444-444444444444">');

    const full = renderToStaticMarkup(
      createElement(EscalationRulesPanel, {
        sector: { id: sectorId, name: "TI" },
        rules: [1, 2, 3, 4, 5].map((index) => other(index)),
        people: [],
        names: {},
      }),
    );
    expect(full).toContain("O setor já tem 5 regras ativas.");
    expect(full).not.toContain(">Criar regra<");
  });

  it("gives each refusal its message", () => {
    const failure = (path: string) => escalationRuleFailureEntity(new ValidationError([{ path: [path], code: "custom" }]));
    expect(failure("overdueDays")).toBe("escalationRuleDays");
    expect(failure("actions")).toBe("escalationRuleEmpty");
    expect(failure("assignToId")).toBe("escalationRulePeople");
    expect(failure("notifyUserIds")).toBe("escalationRulePeople");
    expect(failure("name")).toBe("escalationRules");
    expect(escalationRuleFailureEntity(new ConflictError())).toBe("escalationRules");
    expect(announcement("validation", undefined, "escalationRuleDays")).toContain("N de 1 a 30");
    expect(announcement("validation", undefined, "escalationRuleEmpty")).toContain("pelo menos uma ação");
    expect(announcement("validation", undefined, "escalationRulePeople")).toContain("do próprio setor");
    expect(announcement("dependency", undefined, "escalationRules")).toContain("5 regras ativas");
    expect(announcement(undefined, "deleted", "escalationRules")).toContain("continuam no histórico");
  });

  it("shows a rule's trigger and people by name in the audit trail", () => {
    const format = auditValueFormatter({ [bia]: "Bia", [gabi]: "Gabi" });
    expect(format("trigger", "OVERDUE_DAYS")).toBe("Vencida há N dias");
    expect(format("assignToId", bia)).toBe("Bia");
    expect(format("notifyUserIds", [gabi, "gone"])).toBe("Gabi, (removido)");
    expect(format("notifyUserIds", [])).toBe("Ninguém");
  });
});
