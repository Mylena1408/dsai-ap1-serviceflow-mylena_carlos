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
export function assertCanDecideApproval(actor: LifecycleUser, request: ApprovalRequest): void {
  if (!actor.isActive || actor.role !== "MANAGER" || actor.sectorId === null) {
    throw new NotFoundError();
  }

  if (request.approvalState === null || !canSeeApproval(actor.sectorId, request)) {
    throw new NotFoundError();
  }

  if (request.approvalState !== "PENDING" || request.status !== "OPEN" || pendingApprovalSector(request) !== actor.sectorId) {
    throw new ConflictError();
  }
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
