import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { RequestPriority, RequestStatus } from "./request";

// Assignment, cancellation and reopening rules (SPEC 2026-10-31, sections 5.1 to 5.6).
// Callers load every state from the database; these functions only decide.

export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_NOTE_LENGTH = 1_000;

export type LifecycleRole = "ADMIN" | "REQUESTER" | "ATTENDANT";

export interface LifecycleUser {
  id: string;
  role: LifecycleRole;
  isActive: boolean;
  sectorId: string | null;
}

export interface LifecycleRequest {
  requesterId: string;
  sectorId: string;
  status: RequestStatus;
  completedAt: Date | null;
  /** Current assignee as stored now, or null when nobody assumed the request. */
  assignee: LifecycleUser | null;
  /** SLA state (SPEC 2026-11-01); optional so rules that do not need it stay simple. */
  priority?: RequestPriority;
  slaHoursSnapshot?: number | null;
  dueAt?: Date | null;
}

// Section 5.6. Start and completion keep their own rule in status-transition.ts.
const ALLOWED_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["OPEN"],
  CANCELLED: [],
};

const ASSIGNABLE: readonly RequestStatus[] = ["OPEN", "IN_PROGRESS"];

export function isLifecycleTransitionAllowed(from: RequestStatus, to: RequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function isSectorAttendant(user: LifecycleUser | null, sectorId: string): user is LifecycleUser {
  return user !== null && user.isActive && user.role === "ATTENDANT" && user.sectorId === sectorId;
}

/**
 * Assignee who still counts (section 5.1 item 3): an active attendant of the request's
 * current sector. A deactivated or moved assignee stays recorded but no longer holds it.
 */
export function effectiveAssigneeId(request: LifecycleRequest): string | null {
  return isSectorAttendant(request.assignee, request.sectorId) ? request.assignee.id : null;
}

/** Trims a reason; empty means absent. Longer than 1,000 characters is rejected. */
export function normalizeNote(raw: string | null | undefined): string | null {
  const note = raw?.trim() ?? "";

  if (note === "") {
    return null;
  }

  if ([...note].length > MAX_NOTE_LENGTH) {
    throw new ValidationError([{ path: ["note"], code: "too_big" }]);
  }

  return note;
}

function requireNote(note: string | null): void {
  if (note === null) {
    throw new ValidationError([{ path: ["note"], code: "too_small" }]);
  }
}

// Actors outside the request's scope always get NotFoundError, so nothing is revealed
// (section 5.7). In-scope actors get ConflictError when the state does not allow the action.
function requireSectorAttendant(actor: LifecycleUser, request: LifecycleRequest): void {
  if (!isSectorAttendant(actor, request.sectorId)) {
    throw new NotFoundError();
  }
}

function requireAssignable(request: LifecycleRequest): void {
  if (!ASSIGNABLE.includes(request.status)) {
    throw new ConflictError();
  }
}

/** Section 5.2: assume a request that has no effective assignee. */
export function assertCanAssume(actor: LifecycleUser, request: LifecycleRequest): void {
  requireSectorAttendant(actor, request);
  requireAssignable(request);

  if (effectiveAssigneeId(request) !== null) {
    throw new ConflictError();
  }
}

/** Section 5.2: only the effective assignee releases. */
export function assertCanRelease(actor: LifecycleUser, request: LifecycleRequest): void {
  requireSectorAttendant(actor, request);
  requireAssignable(request);

  if (effectiveAssigneeId(request) !== actor.id) {
    throw new ConflictError();
  }
}

/** Section 5.2 (decision D1): only the effective assignee transfers, within the sector. */
export function assertCanTransfer(
  actor: LifecycleUser,
  request: LifecycleRequest,
  target: LifecycleUser | null,
): void {
  assertCanRelease(actor, request);

  if (!isSectorAttendant(target, request.sectorId) || target.id === actor.id) {
    throw new ValidationError([{ path: ["assigneeId"], code: "invalid_value" }]);
  }
}

/**
 * Section 5.3 (decision D2): with an effective assignee only that attendant starts or
 * completes; without one, any attendant of the sector does, as before.
 */
export function assertCanChangeStatusWithAssignee(
  actorId: string,
  request: LifecycleRequest,
): void {
  const assigneeId = effectiveAssigneeId(request);

  if (assigneeId !== null && assigneeId !== actorId) {
    throw new ConflictError();
  }
}

/**
 * Section 5.4 (decision D3). The requester cancels only an open request, with an optional
 * reason; an attendant of the sector cancels an open or in-progress request with a reason
 * and, when someone holds it, only the assignee does.
 */
export function assertCanCancel(
  actor: LifecycleUser,
  request: LifecycleRequest,
  note: string | null,
): void {
  if (actor.isActive && actor.role === "REQUESTER" && actor.id === request.requesterId) {
    if (request.status !== "OPEN") {
      throw new ConflictError();
    }
    return;
  }

  requireSectorAttendant(actor, request);

  if (!isLifecycleTransitionAllowed(request.status, "CANCELLED")) {
    throw new ConflictError();
  }

  assertCanChangeStatusWithAssignee(actor.id, request);
  requireNote(note);
}

/** Section 5.5 (decisions D4 and D5): the requester reopens within 7 days, with a reason. */
export function assertCanReopen(
  actor: LifecycleUser,
  request: LifecycleRequest,
  now: Date,
  note: string | null,
): void {
  if (!actor.isActive || actor.role !== "REQUESTER" || actor.id !== request.requesterId) {
    throw new NotFoundError();
  }

  if (
    request.status !== "COMPLETED" ||
    request.completedAt === null ||
    now.getTime() - request.completedAt.getTime() > REOPEN_WINDOW_MS
  ) {
    throw new ConflictError();
  }

  requireNote(note);
}

/**
 * SPEC 2026-11-01-sla-prioridades, section 5.1 (decision P1): an attendant of the sector
 * changes the priority of an open or in-progress request; with an effective assignee, only
 * that attendant. The new priority must differ from the current one.
 */
export function assertCanChangePriority(
  actor: LifecycleUser,
  request: LifecycleRequest,
  toPriority: RequestPriority,
): void {
  requireSectorAttendant(actor, request);
  requireAssignable(request);
  assertCanChangeStatusWithAssignee(actor.id, request);

  if (request.priority === toPriority) {
    throw new ValidationError([{ path: ["priority"], code: "invalid_value" }]);
  }
}
