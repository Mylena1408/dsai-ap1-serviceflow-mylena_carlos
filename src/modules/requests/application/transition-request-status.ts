import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { requestStatusTransitionInputSchema } from "@/shared/validation";
import type { RequestWithHistory } from "../domain/request";
import { assertRequestStatusTransition } from "../domain/status-transition";
import type { RequestTransactionRunner } from "./ports";

export async function transitionRequestStatus(
  input: unknown,
  transactions: RequestTransactionRunner,
  now: () => Date = () => new Date(),
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

    const currentRequest = await transaction.findRequestState(parsed.requestId);

    if (
      !currentRequest ||
      currentRequest.sectorId !== currentActor.sectorId
    ) {
      throw new NotFoundError();
    }

    assertRequestStatusTransition(currentRequest.status, parsed.toStatus);
    const occurredAt = now();
    const changed = await transaction.updateStatusIfCurrent({
      requestId: parsed.requestId,
      sectorId: currentActor.sectorId,
      expectedStatus: currentRequest.status,
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

    return transaction.getWithHistory(parsed.requestId);
  });
}
