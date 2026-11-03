import { z } from "zod";
import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import type { LifecycleRequest } from "../domain/lifecycle";
import { slaScheduleAfterResume } from "../domain/sla";
import { assertCanPauseSla, assertCanResumeSla, pauseReason, type SlaResumeCause } from "../domain/sla-pause";
import { supervises } from "./assignment";
import type { RequestTransaction, RequestTransactionRunner } from "./ports";
import { requestClock, scheduleColumns } from "./sla-clock";

// SLA pause "aguardando o solicitante" (SPEC 2026-11-03-pausa-sla-calendario, 5.3 and 5.4).

const pauseInputSchema = z.object({ requestId: entityIdSchema, reason: z.string().max(5_000) }).strict();
const resumeInputSchema = z.object({ requestId: entityIdSchema }).strict();

const EVENT_CAUSE: Record<SlaResumeCause, "manual" | "requester_reply" | "attendance_ended"> = {
  MANUAL: "manual",
  REQUESTER_REPLY: "requester_reply",
  ATTENDANCE_ENDED: "attendance_ended",
};

type PausedRequest = LifecycleRequest & { slaPausedAt: Date; dueAt: Date; slaHoursSnapshot: number };

function isPaused(request: LifecycleRequest): request is PausedRequest {
  return Boolean(request.slaPausedAt && request.dueAt && request.slaHoursSnapshot);
}

/**
 * Section 5.4.4: the columns that end the pause at `at`. The clock time left when it started is
 * left again from `at`; "due soon" goes only in business hours (the trigger computes it otherwise).
 */
export async function resumeColumns(transaction: RequestTransaction, request: LifecycleRequest, at: Date) {
  if (!isPaused(request)) {
    return null;
  }

  const clock = await requestClock(transaction, request.slaBusinessHours);
  const schedule = slaScheduleAfterResume(request.dueAt, request.slaPausedAt, at, request.slaHoursSnapshot, request.priority ?? "NORMAL", clock);
  return { slaPausedAt: null, ...scheduleColumns(schedule, request.slaBusinessHours) } as const;
}

/** Closes the pause row and records `request.sla_resumed`, after the request row was updated. */
export async function closePause(
  transaction: RequestTransaction,
  requestId: string,
  at: Date,
  actorId: string,
  cause: SlaResumeCause,
): Promise<void> {
  const pauseId = await transaction.closeOpenSlaPause({ requestId, resumedAt: at, resumedById: actorId, resumeCause: cause });

  if (pauseId === null) {
    // The request row said "paused" in this same transaction: a missing row is a broken invariant.
    throw new ConflictError();
  }

  await transaction.recordEvent({
    type: "request.sla_resumed",
    requestId,
    occurredAt: at,
    payload: { pauseId, actorId, cause: EVENT_CAUSE[cause] },
  });
}

async function resume(
  transaction: RequestTransaction,
  request: LifecycleRequest,
  requestId: string,
  actorId: string,
  cause: SlaResumeCause,
): Promise<boolean> {
  const at = await transaction.currentTime();
  const columns = await resumeColumns(transaction, request, at);

  if (!columns) {
    return false;
  }

  const changed = await transaction.updateSlaPauseIfCurrent({
    requestId,
    expectedAssigneeId: request.assignee?.id ?? null,
    expectedSlaPausedAt: request.slaPausedAt ?? null,
    updatedAt: at,
    ...columns,
  });

  if (changed !== 1) {
    throw new ConflictError();
  }

  await closePause(transaction, requestId, at, actorId, cause);
  return true;
}

/** Section 5.3: the attendance pauses a running SLA, with a reason. */
export async function pauseRequestSla(input: unknown, transactions: RequestTransactionRunner): Promise<void> {
  const parsed = validateInput(pauseInputSchema, input);
  const reason = pauseReason(parsed.reason);
  const authorized = await requireStatusChangeActor(parsed.requestId);

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(authorized.actorId);
    const request = await transaction.findLifecycleState(parsed.requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    const now = await transaction.currentTime();
    assertCanPauseSla(actor, { ...request, slaPausedAt: request.slaPausedAt ?? null }, now, await supervises(actor, request, transaction));

    const changed = await transaction.updateSlaPauseIfCurrent({
      requestId: parsed.requestId,
      expectedAssigneeId: request.assignee?.id ?? null,
      expectedSlaPausedAt: null,
      slaPausedAt: now,
      updatedAt: now,
    });

    if (changed !== 1) {
      throw new ConflictError();
    }

    const pauseId = await transaction.insertSlaPause({ requestId: parsed.requestId, pausedById: actor.id, reason, pausedAt: now });
    // The reason stays in the pause row; the event carries identifiers (5.8.1).
    await transaction.recordEvent({
      type: "request.sla_paused",
      requestId: parsed.requestId,
      occurredAt: now,
      payload: { pauseId, actorId: actor.id },
    });
  });
}

/** Section 5.4.1: whoever may pause resumes by hand. */
export async function resumeRequestSla(input: unknown, transactions: RequestTransactionRunner): Promise<void> {
  const { requestId } = validateInput(resumeInputSchema, input);
  const authorized = await requireStatusChangeActor(requestId);

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(authorized.actorId);
    const request = await transaction.findLifecycleState(requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    assertCanResumeSla(actor, { ...request, slaPausedAt: request.slaPausedAt ?? null }, await supervises(actor, request, transaction));
    await resume(transaction, request, requestId, actor.id, "MANUAL");
  });
}

/**
 * Section 5.4.2: a comment or a document of the requester resumes the SLA in the same transaction.
 * Nothing happens when the request is not paused or the author is not its requester.
 */
export async function resumeOnRequesterReply(
  transaction: RequestTransaction,
  requestId: string,
  authorId: string,
): Promise<boolean> {
  const request = await transaction.findLifecycleState(requestId);

  if (!request || request.requesterId !== authorId || request.status !== "IN_PROGRESS" || !request.slaPausedAt) {
    return false;
  }

  return resume(transaction, request, requestId, authorId, "REQUESTER_REPLY");
}
