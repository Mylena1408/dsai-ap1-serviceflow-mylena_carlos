import { escalatedPriority } from "./escalation";
import type { RequestPriority } from "./request";

// Application of a sector's escalation rule to a request (SPEC 2026-11-06-aprofundamento-configurabilidade,
// 7.3 items 2 to 4). Pure planning over what the job loaded; the database decides "once per request
// and due date" with its unique index.

export type RuleTriggerKind = "DUE_SOON" | "OVERDUE_DAYS";

export interface AppliedRule {
  id: string;
  sectorId: string;
  name: string;
  trigger: RuleTriggerKind;
  overdueDays: number | null;
  raisePriority: boolean;
  assignToId: string | null;
  notifyManagers: boolean;
  notifyTeam: boolean;
  notifyUserIds: readonly string[];
  isActive: boolean;
}

export interface RuleTarget {
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority: RequestPriority;
  sectorId: string;
  dueAt: Date | null;
  dueSoonAt: Date | null;
  slaPausedAt: Date | null;
  assigneeId: string | null;
}

export interface RulePersonState {
  id: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the rule's trigger holds at `now`: "próxima do vencimento" from the warning instant up to
 * the due date (after it, the request is overdue, not close to it); "vencida há N dias" from N
 * whole days after the due date. Never during the pause, never for a closed request, and only in
 * the rule's sector (the request's current sector, 7.3 item 6).
 */
export function ruleApplies(rule: AppliedRule, request: RuleTarget, now: Date): boolean {
  if (!rule.isActive || rule.sectorId !== request.sectorId) return false;
  if (request.status !== "OPEN" && request.status !== "IN_PROGRESS") return false;
  if (request.slaPausedAt !== null || request.dueAt === null) return false;

  const due = request.dueAt.getTime();
  if (rule.trigger === "DUE_SOON") {
    return request.dueSoonAt !== null && request.dueSoonAt.getTime() <= now.getTime() && now.getTime() < due;
  }
  return rule.overdueDays !== null && due + rule.overdueDays * DAY_MS <= now.getTime();
}

/** The attendant to hand the request to: active attendant of the request's sector (7.3 item 3). */
export function ruleAssigneeAvailable(person: RulePersonState | null, sectorId: string): boolean {
  return person !== null && person.isActive && person.role === "ATTENDANT" && person.sectorId === sectorId;
}

export interface RuleRecipientSources {
  /** Active managers of the request's sector. */
  managerIds: readonly string[];
  /** Active attendants of the request's sector. */
  teamIds: readonly string[];
  /** The chosen people, as they are now. */
  chosen: readonly RulePersonState[];
}

/**
 * 7.1 item 3 and 7.3 item 4: the managers, the team and the chosen people still active in the
 * sector, each once, leaving out who this run already warned about the same request.
 */
export function ruleRecipients(
  rule: Pick<AppliedRule, "notifyManagers" | "notifyTeam" | "notifyUserIds">,
  sectorId: string,
  sources: RuleRecipientSources,
  alreadyWarned: ReadonlySet<string> = new Set(),
): string[] {
  const chosen = new Map(sources.chosen.map((person) => [person.id, person]));
  const ids = [
    ...(rule.notifyManagers ? sources.managerIds : []),
    ...(rule.notifyTeam ? sources.teamIds : []),
    ...rule.notifyUserIds.filter((id) => {
      const person = chosen.get(id);
      return person !== undefined && person.isActive && person.sectorId === sectorId && (person.role === "ATTENDANT" || person.role === "MANAGER");
    }),
  ];
  return [...new Set(ids)].filter((id) => !alreadyWarned.has(id));
}

export interface RulePlan {
  fromPriority: RequestPriority;
  toPriority: RequestPriority;
  /** The new holder, or null when the handover does not happen. */
  assignTo: string | null;
  /** The rule names an attendant who is not available now. */
  assignmentSkipped: boolean;
}

/** 7.3 item 3: one priority level up (never past urgent, the due date stays) and the handover. */
export function planRule(rule: AppliedRule, request: RuleTarget, assignee: RulePersonState | null): RulePlan {
  const toPriority = rule.raisePriority ? escalatedPriority(request.priority) : request.priority;

  if (rule.assignToId === null) {
    return { fromPriority: request.priority, toPriority, assignTo: null, assignmentSkipped: false };
  }
  if (!ruleAssigneeAvailable(assignee, request.sectorId)) {
    return { fromPriority: request.priority, toPriority, assignTo: null, assignmentSkipped: true };
  }
  // Already with that attendant: nothing to hand over.
  return { fromPriority: request.priority, toPriority, assignTo: request.assigneeId === rule.assignToId ? null : rule.assignToId, assignmentSkipped: false };
}
