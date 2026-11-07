import { z } from "zod";
import { ConflictError, ValidationError } from "@/server/errors";
import { entityIdSchema } from "@/shared/validation";

// Escalation rules of a sector (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.1 and 7.3, decisions
// G15 and G16), besides the "Escalar solicitações vencidas" option: a trigger ("próxima do
// vencimento" or "vencida há N dias") and what to do (raise the priority, hand the request to an
// attendant, warn people).

export const MAX_ESCALATION_RULES = 5;
export const MAX_RULE_NAME_LENGTH = 60;
export const MAX_OVERDUE_DAYS = 30;
export const MAX_RULE_PEOPLE = 10;

export const RULE_TRIGGERS = ["DUE_SOON", "OVERDUE_DAYS"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];

export interface EscalationRuleSettings {
  name: string;
  trigger: RuleTrigger;
  overdueDays: number | null;
  raisePriority: boolean;
  assignToId: string | null;
  notifyManagers: boolean;
  notifyTeam: boolean;
  notifyUserIds: string[];
}

export interface EscalationRuleRecord extends EscalationRuleSettings {
  id: string;
  sectorId: string;
  isActive: boolean;
}

/** A person a rule may name: active attendants (both uses) and managers (warnings) of the sector. */
export interface RulePerson {
  id: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorId: string | null;
}

const blankToNull = (value: unknown) => (value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? null : value);

const flag = z.union([z.boolean(), z.enum(["true", "false", "on"])]).optional().transform((value) => value === true || value === "true" || value === "on");

const settingsShape = {
  name: z.string().trim().min(1).max(MAX_RULE_NAME_LENGTH),
  trigger: z.enum(RULE_TRIGGERS),
  overdueDays: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(MAX_OVERDUE_DAYS).nullable()),
  raisePriority: flag,
  assignToId: z.preprocess(blankToNull, entityIdSchema.nullable()),
  notifyManagers: flag,
  notifyTeam: flag,
  notifyUserIds: z
    .array(entityIdSchema)
    .max(MAX_RULE_PEOPLE)
    .optional()
    .transform((ids) => ids ?? [])
    .refine((ids) => new Set(ids).size === ids.length),
};

function checkCombination(settings: Omit<EscalationRuleSettings, "name">, context: z.RefinementCtx): void {
  // N only with "vencida há N dias", and then required.
  if ((settings.trigger === "OVERDUE_DAYS") !== (settings.overdueDays !== null)) {
    context.addIssue({ code: "custom", path: ["overdueDays"] });
  }
  if (!hasEffect(settings)) {
    context.addIssue({ code: "custom", path: ["actions"] });
  }
}

export const escalationRuleSettingsSchema = z.object(settingsShape).strict().superRefine(checkCombination);

export const escalationRuleCreateSchema = z
  .object({ sectorId: entityIdSchema, ...settingsShape })
  .strict()
  .superRefine(checkCombination);

/** 7.3 item 1: at least one action or one recipient. */
export function hasEffect(settings: Pick<EscalationRuleSettings, "raisePriority" | "assignToId" | "notifyManagers" | "notifyTeam" | "notifyUserIds">): boolean {
  return settings.raisePriority || settings.assignToId !== null || settings.notifyManagers || settings.notifyTeam || settings.notifyUserIds.length > 0;
}

/**
 * 7.1 item 3: the attendant to hand requests to is an active attendant of the sector; the people
 * to warn are active attendants or managers of the sector.
 */
export function assertRulePeople(sectorId: string, settings: Pick<EscalationRuleSettings, "assignToId" | "notifyUserIds">, people: readonly RulePerson[]): void {
  const byId = new Map(people.map((person) => [person.id, person]));
  const inSector = (id: string, roles: readonly RulePerson["role"][]) => {
    const person = byId.get(id);
    return person !== undefined && person.isActive && person.sectorId === sectorId && roles.includes(person.role);
  };

  if (settings.assignToId !== null && !inSector(settings.assignToId, ["ATTENDANT"])) {
    throw new ValidationError([{ path: ["assignToId"], code: "invalid_value" }]);
  }
  if (settings.notifyUserIds.some((id) => !inSector(id, ["ATTENDANT", "MANAGER"]))) {
    throw new ValidationError([{ path: ["notifyUserIds"], code: "invalid_value" }]);
  }
}

/** 7.3 item 1 (decision G16): up to 5 active rules per sector. */
export function assertRuleRoom(activeRules: number): void {
  if (activeRules >= MAX_ESCALATION_RULES) {
    throw new ConflictError();
  }
}

/** The same trigger and N appear once among a sector's active rules. */
export function sameCombination(left: Pick<EscalationRuleSettings, "trigger" | "overdueDays">, right: Pick<EscalationRuleSettings, "trigger" | "overdueDays">): boolean {
  return left.trigger === right.trigger && (left.overdueDays ?? 0) === (right.overdueDays ?? 0);
}

/** "Próxima do vencimento" or "Vencida há 3 dias". */
export function ruleTriggerText(rule: Pick<EscalationRuleSettings, "trigger" | "overdueDays">): string {
  if (rule.trigger === "DUE_SOON") return "Próxima do vencimento";
  return rule.overdueDays === 1 ? "Vencida há 1 dia" : `Vencida há ${rule.overdueDays} dias`;
}

/** "Sobe a prioridade · Atribui a Bia · Avisa os gestores, a equipe e 2 pessoas". */
export function ruleEffectText(rule: Omit<EscalationRuleSettings, "name" | "trigger" | "overdueDays">, names: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  if (rule.raisePriority) parts.push("Sobe a prioridade");
  if (rule.assignToId !== null) parts.push(`Atribui a ${names[rule.assignToId] ?? "atendente indisponível"}`);

  const warned = [
    ...(rule.notifyManagers ? ["os gestores"] : []),
    ...(rule.notifyTeam ? ["a equipe"] : []),
    ...rule.notifyUserIds.map((id) => names[id] ?? "pessoa indisponível"),
  ];
  if (warned.length > 0) {
    parts.push(`Avisa ${warned.length === 1 ? warned[0] : `${warned.slice(0, -1).join(", ")} e ${warned.at(-1)}`}`);
  }
  return parts.join(" · ");
}
