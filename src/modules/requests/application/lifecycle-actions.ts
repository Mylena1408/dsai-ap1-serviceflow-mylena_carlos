import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { assertCanCancel, normalizeNote, type LifecycleRequest, type LifecycleUser } from "../domain/lifecycle";
import type { RequestStatus } from "../domain/request";
import { requestCancellationInputSchema } from "./request-schemas";
import type { RequestTransactionRunner, StatusUpdate } from "./ports";

// Cancellation and reopening (SPEC 2026-10-31, sections 5.4 and 5.5). Requester and
// attendant reach the same use case; the domain decides from the reloaded actor and request,
// and any actor outside the request's scope gets "not found".

interface LifecycleChange {
  toStatus: RequestStatus;
  note: string | null;
  decide: (actor: LifecycleUser, request: LifecycleRequest, now: Date) => void;
  stamps: (now: Date) => Pick<StatusUpdate, "completedAt" | "cancelledAt">;
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
      ...change.stamps(occurredAt),
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
