import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { requestStatusTransitionInputSchema } from "./request-schemas";
import type { RequestWithHistory } from "../domain/request";
import { assertCanChangeStatusWithAssignee } from "../domain/lifecycle";
import { assertRequestStatusTransition } from "../domain/status-transition";
import type { RequestTransactionRunner } from "./ports";

export async function transitionRequestStatus(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<RequestWithHistory> {
  const parsed = validateInput(requestStatusTransitionInputSchema, input);
  const authorizedActor = await requireStatusChangeActor(parsed.requestId);

  return transactions.run(async (transaction) => {
    const currentActor = await transaction.findActor(authorizedActor.actorId);

    if (
      !currentActor?.isActive ||
      currentActor.role !== "ATTENDANT" ||
      currentActor.sectorId !== authorizedActor.sectorId
    ) {
      throw new NotFoundError();
    }

    const currentRequest = await transaction.findLifecycleState(parsed.requestId);

    if (
      !currentRequest ||
      currentRequest.sectorId !== currentActor.sectorId
    ) {
      throw new NotFoundError();
    }

    assertRequestStatusTransition(currentRequest.status, parsed.toStatus);
    // With an effective assignee only that attendant starts or completes; without one,
    // any attendant of the sector does, as before (SPEC 2026-10-31, section 5.3).
    assertCanChangeStatusWithAssignee(currentActor.id, currentRequest);
    const occurredAt = await transaction.currentTime();
    const changed = await transaction.updateStatusIfCurrent({
      requestId: parsed.requestId,
      sectorId: currentActor.sectorId,
      expectedStatus: currentRequest.status,
      expectedAssigneeId: currentRequest.assignee?.id ?? null,
      toStatus: parsed.toStatus,
      updatedAt: occurredAt,
      ...(parsed.toStatus === "COMPLETED" ? { completedAt: occurredAt } : {}),
    });

    if (changed !== 1) {
      throw new ConflictError();
    }

    await transaction.insertStatusEvent({
      requestId: parsed.requestId,
      actorId: currentActor.id,
      fromStatus: currentRequest.status,
      toStatus: parsed.toStatus,
      occurredAt,
    });
    await transaction.recordEvent({
      type: "request.status_changed",
      requestId: parsed.requestId,
      occurredAt,
      payload: { fromStatus: currentRequest.status, toStatus: parsed.toStatus, actorId: currentActor.id },
    });

    return transaction.getWithHistory(parsed.requestId);
  });
}
