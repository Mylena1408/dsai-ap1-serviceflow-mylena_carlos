import type { AuditScope } from "@/modules/audit";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import {
  assertRulePeople,
  assertRuleRoom,
  escalationRuleCreateSchema,
  escalationRuleSettingsSchema,
  sameCombination,
  type EscalationRuleRecord,
  type EscalationRuleSettings,
  type RulePerson,
} from "../domain/escalation-rule";

// Configuration of the escalation rules (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 items 1
// and 6): only the administrator, in "Setores"; every change goes to the audit trail. Changing or
// deleting a rule never undoes escalations already made.

export interface RuleChoice {
  id: string;
  name: string;
  role: "ATTENDANT" | "MANAGER";
  sectorId: string;
}

export interface EscalationRuleOverview {
  rules: EscalationRuleRecord[];
  /** Active attendants and managers with a sector, by name. */
  people: RuleChoice[];
}

export interface EscalationRuleReader {
  listRules(): Promise<EscalationRuleRecord[]>;
  listPeople(): Promise<RuleChoice[]>;
}

export interface EscalationRuleTransaction extends AuditScope {
  sectorExists(sectorId: string): Promise<boolean>;
  findRule(ruleId: string): Promise<EscalationRuleRecord | null>;
  /** The sector's active rules, except `exceptId`. */
  activeRules(sectorId: string, exceptId?: string): Promise<EscalationRuleRecord[]>;
  findPeople(ids: readonly string[]): Promise<RulePerson[]>;
  createRule(sectorId: string, settings: EscalationRuleSettings): Promise<EscalationRuleRecord>;
  updateRule(ruleId: string, data: Partial<EscalationRuleSettings> & { isActive?: boolean }): Promise<EscalationRuleRecord>;
  deleteRule(ruleId: string): Promise<void>;
}

export interface EscalationRuleStore {
  run<T>(work: (transaction: EscalationRuleTransaction) => Promise<T>): Promise<T>;
}

export async function listEscalationRuleOverview(reader: EscalationRuleReader): Promise<EscalationRuleOverview> {
  await requireConfigurationAdministrator();
  const [rules, people] = await Promise.all([reader.listRules(), reader.listPeople()]);
  return { rules, people };
}

/** Limit, combination and names of the people, against the sector's other active rules. */
async function assertFits(
  transaction: EscalationRuleTransaction,
  sectorId: string,
  settings: EscalationRuleSettings,
  exceptId?: string,
): Promise<void> {
  const others = await transaction.activeRules(sectorId, exceptId);
  assertRuleRoom(others.length);

  if (others.some((other) => sameCombination(other, settings) || other.name.toLocaleLowerCase("pt-BR") === settings.name.toLocaleLowerCase("pt-BR"))) {
    throw new ConflictError();
  }

  const ids = [...(settings.assignToId ? [settings.assignToId] : []), ...settings.notifyUserIds];
  assertRulePeople(sectorId, settings, ids.length === 0 ? [] : await transaction.findPeople(ids));
}

export async function createEscalationRule(input: unknown, store: EscalationRuleStore): Promise<EscalationRuleRecord> {
  const actor = await requireConfigurationAdministrator();
  const { sectorId, ...settings } = validateInput(escalationRuleCreateSchema, input);

  return store.run(async (transaction) => {
    if (!(await transaction.sectorExists(sectorId))) {
      throw new NotFoundError();
    }

    await assertFits(transaction, sectorId, settings);
    return transaction.audited({ actor, action: "CREATED", entityType: "ESCALATION_RULE" }, () => transaction.createRule(sectorId, settings));
  });
}

/** The sector of a rule does not change; an inactive rule is checked when reactivated. */
export async function updateEscalationRule(id: unknown, input: unknown, store: EscalationRuleStore): Promise<EscalationRuleRecord> {
  const actor = await requireConfigurationAdministrator();
  const ruleId = validateInput(entityIdSchema, id);
  const settings = validateInput(escalationRuleSettingsSchema, input);

  return store.run(async (transaction) => {
    const rule = await transaction.findRule(ruleId);

    if (!rule) {
      throw new NotFoundError();
    }

    if (rule.isActive) {
      await assertFits(transaction, rule.sectorId, settings, ruleId);
    } else {
      const ids = [...(settings.assignToId ? [settings.assignToId] : []), ...settings.notifyUserIds];
      assertRulePeople(rule.sectorId, settings, ids.length === 0 ? [] : await transaction.findPeople(ids));
    }

    return transaction.audited({ actor, action: "UPDATED", entityType: "ESCALATION_RULE", entityId: ruleId }, () =>
      transaction.updateRule(ruleId, settings),
    );
  });
}

/** Reactivating checks the limit and the combination again; the people are checked by the job. */
export async function setEscalationRuleActive(id: unknown, isActive: unknown, store: EscalationRuleStore): Promise<EscalationRuleRecord> {
  const actor = await requireConfigurationAdministrator();
  const ruleId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return store.run(async (transaction) => {
    const rule = await transaction.findRule(ruleId);

    if (!rule) {
      throw new NotFoundError();
    }
    if (rule.isActive === active) {
      return rule;
    }
    if (active) {
      const others = await transaction.activeRules(rule.sectorId, ruleId);
      assertRuleRoom(others.length);
      if (others.some((other) => sameCombination(other, rule) || other.name.toLocaleLowerCase("pt-BR") === rule.name.toLocaleLowerCase("pt-BR"))) {
        throw new ConflictError();
      }
    }

    return transaction.audited(
      { actor, action: active ? "REACTIVATED" : "DEACTIVATED", entityType: "ESCALATION_RULE", entityId: ruleId },
      () => transaction.updateRule(ruleId, { isActive: active }),
    );
  });
}

/** Deleting keeps the escalations already made, with the rule's name (7.3 item 6). */
export async function deleteEscalationRule(id: unknown, store: EscalationRuleStore): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const ruleId = validateInput(entityIdSchema, id);

  await store.run(async (transaction) => {
    if (!(await transaction.findRule(ruleId))) {
      throw new NotFoundError();
    }

    await transaction.audited({ actor, action: "DELETED", entityType: "ESCALATION_RULE", entityId: ruleId }, async () => {
      await transaction.deleteRule(ruleId);
      return { id: ruleId };
    });
  });
}
