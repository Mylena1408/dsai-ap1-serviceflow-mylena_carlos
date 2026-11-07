import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  planRule,
  ruleApplies,
  ruleAssigneeAvailable,
  ruleRecipients,
  type AppliedRule,
  type RuleTarget,
} from "@/modules/requests/domain/escalation-rules";
import { applyEscalationRules, type EscalationRuleRunStore } from "@/modules/requests/application/escalation-rule-runs";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { notificationMessage } from "@/shared/notifications";
import { RequestEscalations, ruleEscalationText } from "@/app/_components/request-escalations";
import { buildTimeline, SYSTEM_ACTOR_NAME } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 items 2 to 5 (SF-174; CA-ESR-03 to 06 by the rules).

const sectorId = "s1";
const now = new Date("2026-11-07T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const rule = (overrides: Partial<AppliedRule> = {}): AppliedRule => ({
  id: "r1",
  sectorId,
  name: "Atraso",
  trigger: "OVERDUE_DAYS",
  overdueDays: 2,
  raisePriority: true,
  assignToId: null,
  notifyManagers: false,
  notifyTeam: false,
  notifyUserIds: [],
  isActive: true,
  ...overrides,
});

const target = (overrides: Partial<RuleTarget> = {}): RuleTarget => ({
  status: "IN_PROGRESS",
  priority: "NORMAL",
  sectorId,
  dueAt: new Date(now.getTime() - 2 * DAY),
  dueSoonAt: new Date(now.getTime() - 3 * DAY),
  slaPausedAt: null,
  assigneeId: "ana",
  ...overrides,
});

describe("when a rule applies (7.3 item 2)", () => {
  it("'vencida há N dias' from N whole days after the due date", () => {
    expect(ruleApplies(rule(), target(), now)).toBe(true);
    expect(ruleApplies(rule(), target({ dueAt: new Date(now.getTime() - 2 * DAY + 1) }), now)).toBe(false);
    expect(ruleApplies(rule({ overdueDays: 1 }), target(), now)).toBe(true);
  });

  it("'próxima do vencimento' from the warning instant up to the due date", () => {
    const soon = rule({ trigger: "DUE_SOON", overdueDays: null });
    expect(ruleApplies(soon, target({ dueAt: new Date(now.getTime() + HOUR), dueSoonAt: new Date(now.getTime() - HOUR) }), now)).toBe(true);
    expect(ruleApplies(soon, target({ dueAt: new Date(now.getTime() + HOUR), dueSoonAt: new Date(now.getTime() + 1) }), now)).toBe(false);
    expect(ruleApplies(soon, target(), now)).toBe(false); // already overdue
    expect(ruleApplies(soon, target({ dueAt: new Date(now.getTime() + HOUR), dueSoonAt: null }), now)).toBe(false);
  });

  it("never during the pause, for a closed request, without a due date, out of the sector or for an inactive rule", () => {
    expect(ruleApplies(rule(), target({ slaPausedAt: now }), now)).toBe(false);
    expect(ruleApplies(rule(), target({ status: "COMPLETED" }), now)).toBe(false);
    expect(ruleApplies(rule(), target({ status: "OPEN" }), now)).toBe(true);
    expect(ruleApplies(rule(), target({ dueAt: null }), now)).toBe(false);
    expect(ruleApplies(rule(), target({ sectorId: "other" }), now)).toBe(false);
    expect(ruleApplies(rule({ isActive: false }), target(), now)).toBe(false);
  });
});

describe("what a rule does (7.3 items 3 and 4)", () => {
  const bia = { id: "bia", role: "ATTENDANT" as const, isActive: true, sectorId };

  it("raises one level, never past urgent", () => {
    expect(planRule(rule(), target(), null)).toMatchObject({ fromPriority: "NORMAL", toPriority: "HIGH" });
    expect(planRule(rule(), target({ priority: "URGENT" }), null)).toMatchObject({ fromPriority: "URGENT", toPriority: "URGENT" });
    expect(planRule(rule({ raisePriority: false }), target(), null)).toMatchObject({ toPriority: "NORMAL" });
  });

  it("hands over to an active attendant of the sector, or skips and says so", () => {
    expect(planRule(rule({ assignToId: "bia" }), target(), bia)).toMatchObject({ assignTo: "bia", assignmentSkipped: false });
    expect(planRule(rule({ assignToId: "bia" }), target({ assigneeId: "bia" }), bia)).toMatchObject({ assignTo: null, assignmentSkipped: false });
    expect(planRule(rule({ assignToId: "bia" }), target(), { ...bia, isActive: false })).toMatchObject({ assignTo: null, assignmentSkipped: true });
    expect(planRule(rule({ assignToId: "bia" }), target(), { ...bia, sectorId: "other" })).toMatchObject({ assignmentSkipped: true });
    expect(planRule(rule({ assignToId: "bia" }), target(), null)).toMatchObject({ assignmentSkipped: true });
    expect(ruleAssigneeAvailable({ ...bia, role: "MANAGER" }, sectorId)).toBe(false);
  });

  it("warns managers, team and the chosen people still in the sector, once each, minus who this run warned", () => {
    const chosen = [
      { id: "gabi", role: "MANAGER" as const, isActive: true, sectorId },
      { id: "gone", role: "ATTENDANT" as const, isActive: false, sectorId },
      { id: "moved", role: "ATTENDANT" as const, isActive: true, sectorId: "other" },
    ];
    const sources = { managerIds: ["gabi", "hugo"], teamIds: ["ana", "bia"], chosen };
    expect(ruleRecipients(rule({ notifyManagers: true, notifyTeam: true, notifyUserIds: ["gabi", "gone", "moved"] }), sectorId, sources)).toEqual([
      "gabi",
      "hugo",
      "ana",
      "bia",
    ]);
    expect(ruleRecipients(rule({ notifyUserIds: ["gabi"] }), sectorId, sources)).toEqual(["gabi"]);
    expect(ruleRecipients(rule({ notifyTeam: true }), sectorId, sources, new Set(["ana"]))).toEqual(["bia"]);
    expect(ruleRecipients(rule(), sectorId, sources)).toEqual([]);
  });
});

describe("the run (7.3 items 2 and 4)", () => {
  it("applies each candidate and never warns the same person twice about a request", async () => {
    const seen: Array<string[]> = [];
    const store: EscalationRuleRunStore = {
      findCandidates: vi.fn(async () => [
        { requestId: "q1", ruleId: "a", dueAt: now },
        { requestId: "q1", ruleId: "b", dueAt: now },
        { requestId: "q2", ruleId: "a", dueAt: now },
        { requestId: "q3", ruleId: "a", dueAt: now },
      ]),
      apply: vi.fn(async (candidate, _now, already) => {
        seen.push([...already]);
        if (candidate.requestId === "q3") return null; // changed meanwhile, or applied by another run
        const warned = ["gabi", "ana"].filter((id) => !already.has(id));
        return { raised: candidate.ruleId === "a", assigned: candidate.ruleId === "b", warned };
      }),
    };
    await expect(applyEscalationRules(now, store, 10)).resolves.toEqual({ applied: 3, raised: 2, assigned: 1, warned: 4 });
    expect(store.findCandidates).toHaveBeenCalledWith(now, 10);
    expect(seen).toEqual([[], ["gabi", "ana"], [], []]);
  });
});

describe("the warning and the detail (7.3 items 4 and 5)", () => {
  it("reaches the people the rule warned while the request is in the attendance", () => {
    const context = { requesterId: "rita", effectiveAssigneeId: "ana", ruleRecipientIds: ["gabi", "ana", "gabi"] };
    expect(
      plannedNotifications({ type: "request.escalated" }, { ...context, slaRecipients: { requestActive: true, sectorAttendantIds: [] } }),
    ).toEqual([
      { recipientId: "gabi", type: "sla.escalated" },
      { recipientId: "ana", type: "sla.escalated" },
    ]);
    expect(plannedNotifications({ type: "request.escalated" }, { ...context, slaRecipients: { requestActive: false, sectorAttendantIds: [] } })).toEqual([]);
  });

  it("a rule's handover is notified as a transfer, with the system as author (G17)", () => {
    expect(
      plannedNotifications(
        { type: "request.assignment_changed", payload: { toAssigneeId: "bia", actorId: null } },
        { requesterId: "rita", effectiveAssigneeId: "bia" },
      ),
    ).toEqual([{ recipientId: "bia", type: "assignment.received" }]);
  });

  it("names the rule in the warning and keeps the option's text", () => {
    expect(notificationMessage({ type: "sla.escalated", serviceName: "Reparo", ruleName: "Atraso" })).toBe('Escalonamento "Atraso": Reparo');
    expect(notificationMessage({ type: "sla.escalated", serviceName: "Reparo" })).toBe("Solicitação vencida escalada: Reparo");
  });

  it("describes each rule's escalation with trigger and actions, and keeps the option's line", () => {
    const at = new Date("2026-11-07T15:00:00Z");
    const base = { fromPriority: "NORMAL" as const, toPriority: "HIGH" as const, occurredAt: at };
    expect(
      ruleEscalationText({ ...base, trigger: "OVERDUE_DAYS", overdueDays: 3, ruleName: "Atraso", assignedTo: { id: "bia", name: "Bia" }, notifiedCount: 2 }),
    ).toBe('Regra "Atraso" (vencida há 3 dias): prioridade Normal → Alta · atribuída a Bia · 2 pessoas avisadas.');
    expect(
      ruleEscalationText({ ...base, toPriority: "NORMAL", trigger: "DUE_SOON", overdueDays: null, ruleName: "Perto", assignmentSkipped: true, notifiedCount: 1 }),
    ).toBe('Regra "Perto" (próxima do vencimento): atribuição ignorada (atendente indisponível) · 1 pessoa avisada.');
    expect(ruleEscalationText({ ...base, toPriority: "NORMAL", trigger: "OVERDUE_DAYS", overdueDays: 1, ruleName: "Um dia" })).toBe(
      'Regra "Um dia" (vencida há 1 dia): nada a fazer.',
    );

    const html = renderToStaticMarkup(
      createElement(RequestEscalations, {
        escalations: [
          { ...base, id: "e1", trigger: "OVERDUE" },
          { ...base, id: "e2", trigger: "DUE_SOON", overdueDays: null, ruleName: "Perto", notifiedCount: 0 },
        ],
      }),
    );
    expect(html).toContain("Vencida e escalada automaticamente em");
    expect(html).toContain("Os gestores do setor foram avisados.");
    expect(html).toContain('Regra &quot;Perto&quot; (próxima do vencimento): prioridade Normal → Alta.');
  });

  it("shows the system as the author of a rule's handover in the history", () => {
    const at = new Date("2026-11-07T15:00:00Z");
    const request = {
      events: [],
      assignmentEvents: [
        { id: "a1", requestId: "q", actorId: null, actor: null, fromAssigneeId: "ana", toAssigneeId: "bia", fromAssignee: { id: "ana", name: "Ana" }, toAssignee: { id: "bia", name: "Bia" }, occurredAt: at },
        { id: "a2", requestId: "q", actorId: null, actor: null, fromAssigneeId: null, toAssigneeId: "bia", fromAssignee: null, toAssignee: { id: "bia", name: "Bia" }, occurredAt: at },
      ],
      priorityEvents: [],
      stageEvents: [],
      sectorEvents: [],
      fieldUpdates: [],
      slaPauses: [],
      approvals: [],
      approval: null,
    } as unknown as RequestWithHistory;
    const entries = buildTimeline(request).filter((entry) => entry.id.startsWith("assignment-"));
    expect(entries.map(({ title, actor }) => [title, actor])).toEqual([
      ["Transferida de Ana para Bia pela regra de escalonamento", SYSTEM_ACTOR_NAME],
      ["Atribuída a Bia pela regra de escalonamento", SYSTEM_ACTOR_NAME],
    ]);
  });
});
