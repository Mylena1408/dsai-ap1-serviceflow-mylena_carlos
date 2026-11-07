import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { normalizeNote, type LifecycleUser } from "./lifecycle";
import type { RequestPriority, RequestStatus } from "./request";
import { dueAtFrom } from "./sla";

// Approval by a manager of the sector (SPEC 2026-11-01-aprovacoes, sections 5.3 to 5.5).
// Callers load every state from the database; these functions only decide.

export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED";
export type ApprovalDecision = "APPROVED" | "REJECTED";

export interface ApprovalRequest {
  sectorId: string;
  status: RequestStatus;
  /** Null when the service did not require approval at opening. */
  approvalState: ApprovalState | null;
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3: copy of the level sectors, current level
   * and the sector deciding it. Optional and empty for requests opened before levels.
   */
  approvalSectorIdsSnapshot?: readonly string[];
  approvalLevel?: number | null;
  approvalPendingSectorId?: string | null;
}

/** Section 5.2: the request keeps whether its service required approval when it was opened. */
export function approvalStateOnOpening(requiresApproval: boolean): ApprovalState | null {
  return requiresApproval ? "PENDING" : null;
}

// Levels (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3, decision G4).

/** The configured level sectors, or one level with the service's sector when none is set (4.3.1). */
export function effectiveApprovalSectors(configured: readonly string[], serviceSectorId: string): string[] {
  return configured.length > 0 ? [...configured] : [serviceSectorId];
}

/** Level sectors of a request; a request opened before levels has one, its own sector. */
export function requestApprovalSectors(request: Pick<ApprovalRequest, "sectorId" | "approvalSectorIdsSnapshot">): string[] {
  const copy = request.approvalSectorIdsSnapshot ?? [];
  return copy.length > 0 ? [...copy] : [request.sectorId];
}

/** The pending level (from 1), or null when nothing is pending. */
export function pendingApprovalLevel(request: Pick<ApprovalRequest, "approvalState" | "approvalLevel">): number | null {
  return request.approvalState === "PENDING" ? (request.approvalLevel ?? 1) : null;
}

/** The sector whose managers decide the pending level, or null when nothing is pending. */
export function pendingApprovalSector(
  request: Pick<ApprovalRequest, "approvalState" | "sectorId" | "approvalPendingSectorId">,
): string | null {
  return request.approvalState === "PENDING" ? (request.approvalPendingSectorId ?? request.sectorId) : null;
}

// Deadline to decide each level (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6, decision
// G6): calendar days from the moment the level becomes pending; nothing is decided automatically.

export const MIN_APPROVAL_DEADLINE_DAYS = 1;
export const MAX_APPROVAL_DEADLINE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Due date of a level that became pending at `pendingSince`, or null without a deadline. */
export function approvalDueAtFrom(pendingSince: Date, deadlineDays: number | null | undefined): Date | null {
  return deadlineDays ? new Date(pendingSince.getTime() + deadlineDays * DAY_MS) : null;
}

/** Whether the pending level is late at `now` (the screens compute it at reading time). */
export function approvalOverdue(
  request: { approvalState: ApprovalState | null; approvalDueAt?: Date | null },
  now: Date,
): boolean {
  return request.approvalState === "PENDING" && !!request.approvalDueAt && request.approvalDueAt.getTime() <= now.getTime();
}

/** Columns of an opening: nothing without approval; otherwise the copy, level 1 and its sector. */
export function approvalColumnsOnOpening(
  requiresApproval: boolean,
  levelSectors: readonly string[],
): {
  approvalState: ApprovalState | null;
  approvalSectorIdsSnapshot: string[];
  approvalLevel: number | null;
  approvalPendingSectorId: string | null;
} {
  return requiresApproval && levelSectors.length > 0
    ? { approvalState: "PENDING", approvalSectorIdsSnapshot: [...levelSectors], approvalLevel: 1, approvalPendingSectorId: levelSectors[0]! }
    : { approvalState: null, approvalSectorIdsSnapshot: [], approvalLevel: null, approvalPendingSectorId: null };
}

/**
 * What an approval leads to (4.3.3): the next level, with its sector, or the end of the approval.
 * A rejection always ends it.
 */
export function approvalAfterDecision(
  request: Pick<ApprovalRequest, "sectorId" | "approvalSectorIdsSnapshot" | "approvalLevel">,
  decision: ApprovalDecision,
): { level: number; next: { level: number; sectorId: string } | null } {
  const sectors = requestApprovalSectors(request);
  const level = request.approvalLevel ?? 1;
  const nextSectorId = decision === "APPROVED" ? sectors[level] : undefined;

  return { level, next: nextSectorId ? { level: level + 1, sectorId: nextSectorId } : null };
}


/** Section 5.3 item 2: nobody starts the attendance while the approval is pending. */
export function assertCanStartWithApproval(approvalState: ApprovalState | null): void {
  if (approvalState === "PENDING") {
    throw new ConflictError();
  }
}

/**
 * Section 5.4 (decision A2), with levels (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.4):
 * an active manager of the sector of the pending level decides it once, while the request is open.
 * Managers of the request's sector or of any of its levels see the request; anyone else does not.
 * A manager who sees it but is not of the pending level gets a conflict (not their turn).
 */
export function assertCanDecideApproval(
  actor: LifecycleUser,
  request: ApprovalRequest,
  /** Sectors of absent managers this actor replaces today (4.3.5). */
  coveredSectorIds: readonly string[] = [],
): void {
  if (!actor.isActive || actor.role !== "MANAGER" || actor.sectorId === null) {
    throw new NotFoundError();
  }

  const actingSectors = [actor.sectorId, ...coveredSectorIds];

  if (request.approvalState === null || !actingSectors.some((sectorId) => canSeeApproval(sectorId, request))) {
    throw new NotFoundError();
  }

  const pendingSector = pendingApprovalSector(request);

  if (request.approvalState !== "PENDING" || request.status !== "OPEN" || pendingSector === null || !actingSectors.includes(pendingSector)) {
    throw new ConflictError();
  }
}

/**
 * The absent manager a decision is made on behalf of (4.3.5): when the actor decides a level of a
 * sector that is not their own, it is as the substitute of that sector's absent manager.
 */
export function decisionOnBehalfOf(
  actorSectorId: string | null,
  pendingSectorId: string | null,
  coverage: ReadonlyArray<{ sectorId: string; managerId: string }>,
): string | null {
  if (pendingSectorId === null || pendingSectorId === actorSectorId) return null;
  return coverage.find(({ sectorId }) => sectorId === pendingSectorId)?.managerId ?? null;
}

/** Managers of the request's sector or of one of its levels see the approval (4.3.4). */
export function canSeeApproval(managerSectorId: string, request: Pick<ApprovalRequest, "sectorId" | "approvalSectorIdsSnapshot">): boolean {
  return managerSectorId === request.sectorId || requestApprovalSectors(request).includes(managerSectorId);
}

/** Section 5.4 item 2: the note is optional when approving and required when rejecting. */
export function decisionNote(decision: ApprovalDecision, raw: string | null | undefined): string | null {
  const note = normalizeNote(raw);

  if (decision === "REJECTED" && note === null) {
    throw new ValidationError([{ path: ["note"], code: "too_small" }]);
  }

  return note;
}

/**
 * Section 5.5 (decision A3): with approval, the SLA starts at the approval, with the current
 * priority. While pending (or after a rejection) there is no due date.
 */
export function dueAtOnApproval(
  approvedAt: Date,
  slaHoursSnapshot: number | null,
  priority: RequestPriority,
): Date | null {
  return dueAtFrom(approvedAt, slaHoursSnapshot, priority);
}

/** Due date at opening: none while an approval is pending, as before otherwise. */
export function dueAtOnOpening(
  openedAt: Date,
  slaHoursSnapshot: number | null,
  priority: RequestPriority,
  approvalState: ApprovalState | null,
): Date | null {
  return approvalState === "PENDING" ? null : dueAtFrom(openedAt, slaHoursSnapshot, priority);
}
