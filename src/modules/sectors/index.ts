import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/sector-use-cases";
import * as escalationRules from "./application/escalation-rules";
import { createPrismaEscalationRuleReader, createPrismaEscalationRuleStore } from "./infrastructure/prisma-escalation-rules";
import type { SectorRecord } from "./domain/sector";
import {
  createPrismaSectorRepository,
  createPrismaSectorTransactionRunner,
} from "./infrastructure/prisma-sector-repository";

export { assertSectorCanBeDeactivated } from "./domain/deactivation";
export type { SectorDeactivationDependencies } from "./domain/deactivation";
export type { SectorRecord } from "./domain/sector";

export async function listSectors(database: PrismaClient = prisma): Promise<SectorRecord[]> {
  return useCases.listSectors(createPrismaSectorRepository(database));
}

/** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1. */
export async function listApprovalSectorChoices(database: PrismaClient = prisma): Promise<Array<{ id: string; name: string }>> {
  return useCases.listApprovalSectorChoices(createPrismaSectorRepository(database));
}

export async function listSectorsForCatalog(database: PrismaClient = prisma): Promise<SectorRecord[]> {
  return useCases.listSectorsForCatalog(createPrismaSectorRepository(database));
}

export async function createSector(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.createSector(input, createPrismaSectorTransactionRunner(database));
}

export async function updateSector(
  id: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.updateSector(id, input, createPrismaSectorTransactionRunner(database));
}

export async function setSectorEscalation(
  id: unknown,
  enabled: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.setSectorEscalation(id, enabled, createPrismaSectorTransactionRunner(database));
}

export async function setSectorActive(
  id: unknown,
  isActive: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.setSectorActive(id, isActive, createPrismaSectorTransactionRunner(database));
}

// Escalation rules (SPEC 2026-11-06-aprofundamento-configurabilidade, part E).
export {
  MAX_ESCALATION_RULES,
  MAX_OVERDUE_DAYS,
  MAX_RULE_NAME_LENGTH,
  MAX_RULE_PEOPLE,
  RULE_TRIGGERS,
  hasEffect,
  ruleEffectText,
  ruleTriggerText,
  type EscalationRuleRecord,
  type EscalationRuleSettings,
  type RuleTrigger,
} from "./domain/escalation-rule";
export type { EscalationRuleOverview, RuleChoice } from "./application/escalation-rules";

export async function listEscalationRuleOverview(database: PrismaClient = prisma): Promise<escalationRules.EscalationRuleOverview> {
  return escalationRules.listEscalationRuleOverview(createPrismaEscalationRuleReader(database));
}

export async function createEscalationRule(input: unknown, database: PrismaClient = prisma) {
  return escalationRules.createEscalationRule(input, createPrismaEscalationRuleStore(database));
}

export async function updateEscalationRule(id: unknown, input: unknown, database: PrismaClient = prisma) {
  return escalationRules.updateEscalationRule(id, input, createPrismaEscalationRuleStore(database));
}

export async function setEscalationRuleActive(id: unknown, isActive: unknown, database: PrismaClient = prisma) {
  return escalationRules.setEscalationRuleActive(id, isActive, createPrismaEscalationRuleStore(database));
}

export async function deleteEscalationRule(id: unknown, database: PrismaClient = prisma): Promise<void> {
  return escalationRules.deleteEscalationRule(id, createPrismaEscalationRuleStore(database));
}
