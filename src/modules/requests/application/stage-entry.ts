import { stageAssigneeAt, stageDueAtFrom, stageTargetDaysAt, type StageDetails } from "../domain/stages";
import type { LifecycleUser } from "../domain/lifecycle";
import type { RequestTransaction } from "./ports";

// Entering a stage (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1 and 5.3.2; decisions G9
// and G10). The start of the attendance enters the first stage; advancing and going back enter
// another one. The callers write the stage itself; this module decides the due date and moves the
// request to the stage's attendant when there is one.

/** Who may receive the request on entering a stage: an active attendant of its current sector. */
export function stageAssigneeAvailable(user: LifecycleUser | null, requestSectorId: string): boolean {
  return !!user && user.isActive && user.role === "ATTENDANT" && user.sectorId === requestSectorId;
}

/** The due date of the stage entered at `at`, and its delay not announced yet. */
export function stageEntryDue(details: Partial<StageDetails>, index: number, at: Date): { stageDueAt: Date | null; stageOverdueNotifiedAt: null } {
  return { stageDueAt: stageDueAtFrom(at, stageTargetDaysAt(details, index)), stageOverdueNotifiedAt: null };
}

export interface StageEntryAssignment {
  /** The attendant the request went to, or null when nothing changed. */
  assignedTo: string | null;
  /** The stage has an attendant, but they could not receive the request (recorded in the history). */
  unavailable: boolean;
}

/**
 * 5.3.1: moves the request to the stage's attendant, with the history, the event and therefore the
 * transfer notification, as a transfer made by whoever entered the stage. Nothing changes without a
 * stage attendant, when they already hold it, or when they are no longer an active attendant of the
 * request's current sector (then `unavailable`).
 */
export async function assignStageAttendant(
  transaction: RequestTransaction,
  input: {
    requestId: string;
    requestSectorId: string;
    details: Partial<StageDetails>;
    stageIndex: number;
    currentAssigneeId: string | null;
    actorId: string;
    at: Date;
  },
): Promise<StageEntryAssignment> {
  const target = stageAssigneeAt(input.details, input.stageIndex);

  if (target === null || target === input.currentAssigneeId) {
    return { assignedTo: null, unavailable: false };
  }

  if (!stageAssigneeAvailable(await transaction.findUserForAssignment(target), input.requestSectorId)) {
    return { assignedTo: null, unavailable: true };
  }

  const changed = await transaction.updateAssigneeIfCurrent({
    requestId: input.requestId,
    expectedStatus: "IN_PROGRESS",
    expectedAssigneeId: input.currentAssigneeId,
    assigneeId: target,
    updatedAt: input.at,
  });

  if (changed !== 1) {
    // The request changed meanwhile; the stage move itself already checked it, so this is only a
    // second line of defence and leaves the assignee as it is.
    return { assignedTo: null, unavailable: false };
  }

  await transaction.insertAssignmentEvent({
    requestId: input.requestId,
    actorId: input.actorId,
    fromAssigneeId: input.currentAssigneeId,
    toAssigneeId: target,
    occurredAt: input.at,
  });
  await transaction.recordEvent({
    type: "request.assignment_changed",
    requestId: input.requestId,
    occurredAt: input.at,
    payload: { fromAssigneeId: input.currentAssigneeId, toAssigneeId: target, actorId: input.actorId },
  });

  return { assignedTo: target, unavailable: false };
}
