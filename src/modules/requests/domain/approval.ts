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
}

/** Section 5.2: the request keeps whether its service required approval when it was opened. */
export function approvalStateOnOpening(requiresApproval: boolean): ApprovalState | null {
  return requiresApproval ? "PENDING" : null;
}

/** Section 5.3 item 2: nobody starts the attendance while the approval is pending. */
export function assertCanStartWithApproval(approvalState: ApprovalState | null): void {
  if (approvalState === "PENDING") {
    throw new ConflictError();
  }
}

/**
 * Section 5.4 (decision A2): an active manager of the request's sector decides once, while the
 * approval is pending and the request is open. Anyone else does not see the request.
 */
export function assertCanDecideApproval(actor: LifecycleUser, request: ApprovalRequest): void {
  if (!actor.isActive || actor.role !== "MANAGER" || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }

  if (request.approvalState === null) {
    throw new NotFoundError();
  }

  if (request.approvalState !== "PENDING" || request.status !== "OPEN") {
    throw new ConflictError();
  }
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
