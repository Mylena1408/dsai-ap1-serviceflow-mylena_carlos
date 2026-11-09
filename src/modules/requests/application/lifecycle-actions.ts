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
import { slaScheduleFrom } from "../domain/sla";
import { requestClock, scheduleColumns } from "./sla-clock";
import { closePause, resumeColumns } from "./sla-pause";
import type { SlaClock } from "@/shared/business-clock";
import { NO_STAGE, NO_STAGE_DETAILS } from "../domain/stages";
import { requestCancellationInputSchema, requestReopeningInputSchema } from "./request-schemas";
import { requestShortCode } from "@/shared/requests";
import type { RequestTransaction, RequestTransactionRunner, StatusUpdate } from "./ports";

// Cancellation and reopening (SPEC 2026-10-31, sections 5.4 and 5.5). Requester and
// attendant reach the same use case; the domain decides from the reloaded actor and request,
// and any actor outside the request's scope gets "not found".

interface LifecycleChange {
  toStatus: RequestStatus;
  note: string | null;
  /** SPEC 2026-11-08-atendimento-dia-a-dia, 8.4. */
  reason?: "DUPLICATE";
  /** More writes in the same transaction, after the status changed. */
  after?: (transaction: RequestTransaction, actor: LifecycleUser, request: LifecycleRequest, at: Date) => Promise<void>;
  /** Reads needed before the decision (in the same transaction). */
  prepare?: (transaction: RequestTransaction) => Promise<void>;
  decide: (actor: LifecycleUser, request: LifecycleRequest, now: Date) => void;
  stamps: (
    now: Date,
    request: LifecycleRequest,
    clock: () => Promise<SlaClock>,
  ) => Promise<
    Pick<
      StatusUpdate,
      "completedAt" | "cancelledAt" | "completedLate" | "dueAt" | "dueSoonAt" | "resetSlaAlerts" | "stageNamesSnapshot" | "stageIndex"
    >
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
    await change.prepare?.(transaction);
    // SPEC 2026-11-03-pausa-sla-calendario, 5.4.3: cancelling ends a running pause.
    const ending = await resumeColumns(transaction, request, occurredAt);

    const changed = await transaction.updateStatusIfCurrent({
      requestId,
      sectorId: request.sectorId,
      expectedStatus: request.status,
      expectedAssigneeId: request.assignee?.id ?? null,
      toStatus: change.toStatus,
      updatedAt: occurredAt,
      ...(await change.stamps(occurredAt, request, () => requestClock(transaction, request.slaBusinessHours))),
      ...(ending ? { slaPausedAt: null, expectedSlaPausedAt: request.slaPausedAt ?? null } : {}),
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
      ...(change.reason ? { reason: change.reason } : {}),
    });
    // The reason stays in the history only; the event carries codes (SPEC de eventos, 6.1).
    await transaction.recordEvent({
      type: "request.status_changed",
      requestId,
      occurredAt,
      payload: { fromStatus: request.status, toStatus: change.toStatus, actorId: actor.id },
    });

    if (ending) {
      await closePause(transaction, requestId, occurredAt, actor.id, "ATTENDANCE_ENDED");
    }

    await change.after?.(transaction, actor, request, occurredAt);
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
    stamps: async (now) => ({ cancelledAt: now }),
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
    stamps: async (now, request, clock) => ({
      completedAt: null,
      completedLate: null,
      // On the request's clock (SPEC 2026-11-03-pausa-sla-calendario, 5.2.5).
      ...scheduleColumns(
        request.slaHoursSnapshot === null || request.slaHoursSnapshot === undefined
          ? null
          : slaScheduleFrom(now, request.slaHoursSnapshot, request.priority ?? "NORMAL", await clock()),
        request.slaBusinessHours,
      ),
      resetSlaAlerts: true,
      // SPEC 2026-11-01-fluxos-configuraveis, 5.4: no stage until the attendance starts again.
      ...NO_STAGE,
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.4: nor the stage details.
      ...NO_STAGE_DETAILS,
    }),
  });
}

/**
 * SPEC 2026-11-08-atendimento-dia-a-dia, part F (decisions I17 and I18): closes a request linked as "duplicada de" another.
 * Who may cancel it today (an attendant of the sector, its holder) cancels it with "Duplicada de #código" and the note;
 * in the same transaction the links' history marks the closing on both requests, and the duplicate's requester starts
 * following the original (unless they opened it). The original must not be cancelled; without the link, it is a conflict.
 */
export async function closeAsDuplicate(input: unknown, transactions: RequestTransactionRunner): Promise<void> {
  const parsed = validateInput(requestCancellationInputSchema, input);
  const note = normalizeNote(parsed.note);
  let original: { id: string; status: RequestStatus; requesterId: string } | null = null;

  await changeLifecycle(parsed.requestId, transactions, {
    toStatus: "CANCELLED",
    reason: "DUPLICATE",
    // Read when the history is written, after `prepare` found the original.
    get note() {
      return original ? duplicateNote(requestShortCode(original.id), note) : note;
    },
    decide: (actor, request) => {
      if (actor.role !== "ATTENDANT") throw new NotFoundError();
      assertCanCancel(actor, request, note);
    },
    prepare: async (transaction) => {
      original = (await transaction.findDuplicateOriginal?.(parsed.requestId)) ?? null;
      if (!original || original.status === "CANCELLED") throw new ConflictError();
    },
    stamps: async (now) => ({ cancelledAt: now }),
    after: async (transaction, actor, request, at) => {
      if (!original) throw new ConflictError();
      await transaction.insertClosedAsDuplicate?.(parsed.requestId, original.id, actor.id, at);
      if (original.requesterId !== request.requesterId) {
        await transaction.followOriginal?.(original.id, request.requesterId, actor.id, at);
      }
    },
  });
}

/** 8.3 item 2: "Duplicada de #AB12CD34. <nota>". */
export function duplicateNote(originalCode: string, note: string | null): string {
  return note ? `Duplicada de #${originalCode}. ${note}` : `Duplicada de #${originalCode}.`;
}
