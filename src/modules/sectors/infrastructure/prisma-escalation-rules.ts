import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { EscalationRuleReader, EscalationRuleStore, EscalationRuleTransaction, RuleChoice } from "../application/escalation-rules";
import type { EscalationRuleRecord, RuleTrigger } from "../domain/escalation-rule";

// Escalation rules in PostgreSQL (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.4). The shape,
// the names and the combinations of the active rules are also checked by the database.

type Client = PrismaClient | Prisma.TransactionClient;

const columns = {
  id: true,
  sectorId: true,
  name: true,
  trigger: true,
  overdueDays: true,
  raisePriority: true,
  assignToId: true,
  notifyManagers: true,
  notifyTeam: true,
  notifyUserIds: true,
  isActive: true,
} as const;

type Row = Prisma.SectorEscalationRuleGetPayload<{ select: typeof columns }>;

// Only rules are read here; OVERDUE belongs to the sector's option and the CHECK refuses it.
const toRecord = (row: Row): EscalationRuleRecord => ({ ...row, trigger: row.trigger as RuleTrigger });

function listRules(client: Client) {
  return client.sectorEscalationRule
    .findMany({ select: columns, orderBy: [{ sectorId: "asc" }, { isActive: "desc" }, { name: "asc" }] })
    .then((rows) => rows.map(toRecord));
}

export function createPrismaEscalationRuleReader(database: PrismaClient): EscalationRuleReader {
  return {
    listRules: () => listRules(database),
    async listPeople() {
      const rows = await database.user.findMany({
        where: { isActive: true, role: { in: ["ATTENDANT", "MANAGER"] }, sectorId: { not: null } },
        select: { id: true, name: true, role: true, sectorId: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return rows.map((row) => ({ ...row, sectorId: row.sectorId as string }) as RuleChoice);
    },
  };
}

function transactionOf(client: Prisma.TransactionClient): EscalationRuleTransaction {
  return {
    ...createPrismaAuditScope(client),
    async sectorExists(sectorId) {
      return (await client.sector.count({ where: { id: sectorId } })) > 0;
    },
    async findRule(ruleId) {
      const row = await client.sectorEscalationRule.findUnique({ where: { id: ruleId }, select: columns });
      return row && toRecord(row);
    },
    async activeRules(sectorId, exceptId) {
      const rows = await client.sectorEscalationRule.findMany({
        where: { sectorId, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: columns,
      });
      return rows.map(toRecord);
    },
    findPeople(ids) {
      return client.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, role: true, isActive: true, sectorId: true } });
    },
    async createRule(sectorId, settings) {
      return toRecord(await client.sectorEscalationRule.create({ data: { sectorId, ...settings }, select: columns }));
    },
    async updateRule(ruleId, data) {
      return toRecord(await client.sectorEscalationRule.update({ where: { id: ruleId }, data, select: columns }));
    },
    async deleteRule(ruleId) {
      await client.sectorEscalationRule.delete({ where: { id: ruleId } });
    },
  };
}

export function createPrismaEscalationRuleStore(database: PrismaClient): EscalationRuleStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(transactionOf(transaction)), {
        // Two changes at once: the unique indexes of the active names and combinations refuse one.
        translate: ["P2002", "P2025", "P2003", "P2034"],
        fallbackMessage: "Escalation rule operation failed.",
      });
    },
  };
}
