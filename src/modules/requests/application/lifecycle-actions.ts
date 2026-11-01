import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import {
  assertCanCancel,
  assertCanReopen,
  normalizeNote,
  type LifecycleRequest,
  type LifecycleUser,
} from "../domain/lifecycle";
import type { RequestStatus } from "../domain/request";
import { dueAtFrom } from "../domain/sla";
import { NO_STAGE } from "../domain/stages";
import { requestCancellationInputSchema, requestReopeningInputSchema } from "./request-schemas";
import type { RequestTransactionRunner, StatusUpdate } from "./ports";

// Cancellation and reopening (SPEC 2026-10-31, sections 5.4 and 5.5). Requester and
// attendant reach the same use case; the domain decides from the reloaded actor and request,
// and any actor outside the request's scope gets "not found".

interface LifecycleChange {
  toStatus: RequestStatus;
  note: string | null;
  decide: (actor: LifecycleUser, request: LifecycleRequest, now: Date) => void;
  stamps: (
    now: Date,
    request: LifecycleRequest,
  ) => Pick<
    StatusUpdate,
    "completedAt" | "cancelledAt" | "completedLate" | "dueAt" | "resetSlaAlerts" | "stageNamesSnapshot" | "stageIndex"
  >;
}

async function changeLifecycle(
  requestId: string,
  transactions: RequestTransactionRunner,
  change: LifecycleChange,
): Promise<void> {
  const sessionActor = await requireCurrentActor();

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(sessionActor.id);
    const request = await transaction.findLifecycleState(requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    const occurredAt = await transaction.currentTime();
    change.decide(actor, request, occurredAt);

    const changed = await transaction.updateStatusIfCurrent({
      requestId,
      sectorId: request.sectorId,
      expectedStatus: request.status,
      expectedAssigneeId: request.assignee?.id ?? null,
      toStatus: change.toStatus,
      updatedAt: occurredAt,
      ...change.stamps(occurredAt, request),
    });

    // Status or assignee changed after the read (section 5.8).
    if (changed !== 1) {
      throw new ConflictError();
    }

    await transaction.insertStatusEvent({
      requestId,
      actorId: actor.id,
      fromStatus: request.status,
      toStatus: change.toStatus,
      occurredAt,
      note: change.note,
    });
    // The reason stays in the history only; the event carries codes (SPEC de eventos, 6.1).
    await transaction.recordEvent({
      type: "request.status_changed",
      requestId,
      occurredAt,
      payload: { fromStatus: request.status, toStatus: change.toStatus, actorId: actor.id },
    });
  });
}

/**
 * Section 5.4 (decision D3): the requester cancels an open request, reason optional; an
 * attendant of the sector cancels an open or in-progress request with a reason.
 */
export async function cancelRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<void> {
  const parsed = validateInput(requestCancellationInputSchema, input);
  const note = normalizeNote(parsed.note);

  await changeLifecycle(parsed.requestId, transactions, {
    toStatus: "CANCELLED",
    note,
    decide: (actor, request) => assertCanCancel(actor, request, note),
    stamps: (now) => ({ cancelledAt: now }),
  });
}

/**
 * Section 5.5 (decisions D4 and D5): the requester reopens a completed request within 7 days
 * of completion, measured with the database clock, with a reason. The request returns to
 * OPEN with completedAt cleared and the assignee kept.
 */
export async function reopenRequest(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<void> {
  const parsed = validateInput(requestReopeningInputSchema, input);
  const note = normalizeNote(parsed.note);

  await changeLifecycle(parsed.requestId, transactions, {
    toStatus: "OPEN",
    note,
    decide: (actor, request, now) => assertCanReopen(actor, request, now, note),
    // SPEC 2026-11-01, section 5.3: a new due date from the reopening, with the current
    // priority; the completion result is cleared and new alerts are allowed.
    stamps: (now, request) => ({
      completedAt: null,
      completedLate: null,
      dueAt: dueAtFrom(now, request.slaHoursSnapshot ?? null, request.priority ?? "NORMAL"),
      resetSlaAlerts: true,
      // SPEC 2026-11-01-fluxos-configuraveis, 5.4: no stage until the attendance starts again.
      ...NO_STAGE,
    }),
  });
}
