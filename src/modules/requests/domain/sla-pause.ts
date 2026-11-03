import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { effectiveAssigneeId, type LifecycleRequest, type LifecycleUser } from "./lifecycle";

// SLA pause "aguardando o solicitante" (SPEC 2026-11-03-pausa-sla-calendario, 5.3 and 5.4).
// Callers load every state from the database; these functions only decide.

export const MAX_PAUSE_REASON_LENGTH = 500;

export type SlaResumeCause = "MANUAL" | "REQUESTER_REPLY" | "ATTENDANCE_ENDED";

export interface PausableRequest extends LifecycleRequest {
  slaPausedAt: Date | null;
}

/** Section 5.3 item 1: mandatory, 1 to 500 characters (code points) once trimmed. */
export function pauseReason(raw: string | null | undefined): string {
  const reason = typeof raw === "string" ? raw.trim() : "";

  if (reason === "") {
    throw new ValidationError([{ path: ["reason"], code: "too_small" }]);
  }

  if ([...reason].length > MAX_PAUSE_REASON_LENGTH) {
    throw new ValidationError([{ path: ["reason"], code: "too_big" }]);
  }

  return reason;
}

/**
 * Section 5.3 item 3: the effective assignee (any attendant of the sector when nobody holds it),
 * or a queue supervisor of the sector. Someone who is
 * not an attendant of the current sector does not see the request (404); a colleague without
 * the right gets 409, as when starting or releasing a colleague's request.
 */
function requireHolder(actor: LifecycleUser, request: LifecycleRequest, supervisor: boolean): void {
  if (!actor.isActive || actor.role !== "ATTENDANT" || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }

  const holderId = effectiveAssigneeId(request);

  // Without an effective assignee (released), any attendant of the sector acts (5.4.3, SF-130).
  if (holderId !== null && holderId !== actor.id && !supervisor) {
    throw new ConflictError();
  }
}

/**
 * Section 5.3 item 2: in progress, with an SLA, not paused and not overdue at `now`. At the due
 * date itself the request is still "due soon" (SLA SPEC, 5.4), so it may still be paused.
 */
export function assertCanPauseSla(actor: LifecycleUser, request: PausableRequest, now: Date, supervisor = false): void {
  requireHolder(actor, request, supervisor);

  if (
    request.status !== "IN_PROGRESS" ||
    request.slaHoursSnapshot === null ||
    request.slaHoursSnapshot === undefined ||
    !request.dueAt ||
    request.slaPausedAt !== null ||
    now.getTime() > request.dueAt.getTime()
  ) {
    throw new ConflictError();
  }
}

/** Section 5.4 item 1: whoever may pause resumes a paused request by hand. */
export function assertCanResumeSla(actor: LifecycleUser, request: PausableRequest, supervisor = false): void {
  requireHolder(actor, request, supervisor);

  if (request.status !== "IN_PROGRESS" || request.slaPausedAt === null) {
    throw new ConflictError();
  }
}
