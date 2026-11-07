import { Prisma, type PrismaClient } from "@prisma/client";
import { recordOutboxEvent } from "@/modules/events";
import type { EscalationRuleRunStore, RuleCandidate } from "../application/escalation-rule-runs";
import { planRule, ruleApplies, ruleRecipients, type AppliedRule } from "../domain/escalation-rules";

// Escalation rules applied by the daily job (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3).
// The candidates come from one query; each application re-reads the request and the rule in its own
// transaction. Two runs at once: the unique index (request, rule, due date) refuses the second.

const ACTIVE_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

const ruleColumns = {
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

const personColumns = { id: true, role: true, isActive: true, sectorId: true } as const;

function isDuplicate(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
}

export function createPrismaEscalationRuleRunStore(database: PrismaClient): EscalationRuleRunStore {
  return {
    async findCandidates(now, limit) {
      // "Próxima do vencimento": from the warning instant (kept by a trigger) up to the due date.
      // "Vencida há N dias": N whole days after the due date. Not paused; the rule's sector is the
      // request's current sector; not yet applied to this due date.
      return database.$queryRaw<RuleCandidate[]>`
        SELECT r."id" AS "requestId", ru."id" AS "ruleId", r."dueAt" AS "dueAt"
        FROM "SectorEscalationRule" ru
        JOIN "Request" r ON r."sectorId" = ru."sectorId"
        WHERE ru."isActive"
          AND r."status" IN ('OPEN', 'IN_PROGRESS')
          AND r."slaPausedAt" IS NULL
          AND r."dueAt" IS NOT NULL
          AND (
            (ru."trigger" = 'DUE_SOON' AND r."dueSoonAt" <= ${now} AND r."dueAt" > ${now})
            OR (ru."trigger" = 'OVERDUE_DAYS' AND r."dueAt" + ru."overdueDays" * interval '1 day' <= ${now})
          )
          AND NOT EXISTS (
            SELECT 1 FROM "RequestEscalation" e
            WHERE e."requestId" = r."id" AND e."ruleId" = ru."id" AND e."dueAt" = r."dueAt"
          )
        ORDER BY r."dueAt" ASC, r."id" ASC, ru."trigger" ASC, ru."overdueDays" ASC NULLS FIRST
        LIMIT ${limit}`;
    },

    async apply(candidate, now, alreadyWarned) {
      try {
        return await database.$transaction(async (transaction) => {
          const [request, row] = await Promise.all([
            transaction.request.findUnique({
              where: { id: candidate.requestId },
              select: { status: true, priority: true, sectorId: true, dueAt: true, dueSoonAt: true, slaPausedAt: true, assigneeId: true },
            }),
            transaction.sectorEscalationRule.findUnique({ where: { id: candidate.ruleId }, select: ruleColumns }),
          ]);
          if (!request || !row || request.dueAt?.getTime() !== candidate.dueAt.getTime()) return null;

          const rule = row as AppliedRule;
          if (!ruleApplies(rule, request, now)) return null;

          const assignee = rule.assignToId ? await transaction.user.findUnique({ where: { id: rule.assignToId }, select: personColumns }) : null;
          const plan = planRule(rule, request, assignee);
          const [managerIds, teamIds, chosen] = await Promise.all([
            rule.notifyManagers ? activeIds(transaction, request.sectorId, "MANAGER") : [],
            rule.notifyTeam ? activeIds(transaction, request.sectorId, "ATTENDANT") : [],
            rule.notifyUserIds.length > 0 ? transaction.user.findMany({ where: { id: { in: [...rule.notifyUserIds] } }, select: personColumns }) : [],
          ]);
          const warned = ruleRecipients(rule, request.sectorId, { managerIds, teamIds, chosen }, alreadyWarned);
          const where = { id: candidate.requestId, status: { in: [...ACTIVE_STATUSES] }, dueAt: request.dueAt, slaPausedAt: null };

          // One level up; the due date stays (7.3 item 3).
          let raised = false;
          if (plan.toPriority !== plan.fromPriority) {
            const changed = await transaction.request.updateMany({ where: { ...where, priority: plan.fromPriority }, data: { priority: plan.toPriority } });
            if (changed.count !== 1) return null;
            raised = true;
          }

          // The handover, with the system as author (decision G17), notified as a transfer.
          let assignedToId: string | null = null;
          if (plan.assignTo !== null) {
            const changed = await transaction.request.updateMany({
              where: { ...where, assigneeId: request.assigneeId },
              data: { assigneeId: plan.assignTo, updatedAt: now },
            });
            if (changed.count !== 1) return null;
            assignedToId = plan.assignTo;
            await transaction.requestAssignmentEvent.create({
              data: { requestId: candidate.requestId, actorId: null, fromAssigneeId: request.assigneeId, toAssigneeId: plan.assignTo, occurredAt: now },
            });
            await recordOutboxEvent(transaction, {
              type: "request.assignment_changed",
              requestId: candidate.requestId,
              occurredAt: now,
              payload: { fromAssigneeId: request.assigneeId, toAssigneeId: plan.assignTo, actorId: null },
            });
          }

          const escalation = await transaction.requestEscalation.create({
            data: {
              requestId: candidate.requestId,
              fromPriority: plan.fromPriority,
              toPriority: plan.toPriority,
              occurredAt: now,
              trigger: rule.trigger,
              overdueDays: rule.overdueDays,
              ruleId: rule.id,
              ruleName: rule.name,
              dueAt: request.dueAt,
              assignedToId,
              assignmentSkipped: plan.assignmentSkipped,
              notifiedUserIds: warned,
            },
            select: { id: true },
          });
          await recordOutboxEvent(transaction, {
            type: "request.escalated",
            requestId: candidate.requestId,
            occurredAt: now,
            payload: { escalationId: escalation.id },
          });

          return { raised, assigned: assignedToId !== null, warned };
        });
      } catch (error) {
        // Another run applied the rule to this due date first.
        if (isDuplicate(error)) return null;
        throw error;
      }
    },
  };
}

async function activeIds(client: Prisma.TransactionClient, sectorId: string, role: "MANAGER" | "ATTENDANT"): Promise<string[]> {
  const rows = await client.user.findMany({ where: { sectorId, role, isActive: true }, select: { id: true }, orderBy: { id: "asc" } });
  return rows.map(({ id }) => id);
}
