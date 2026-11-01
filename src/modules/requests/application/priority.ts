import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { assertCanChangePriority } from "../domain/lifecycle";
import { dueAtAfterPriorityChange } from "../domain/sla";
import { requestPriorityInputSchema } from "./request-schemas";
import type { RequestTransactionRunner } from "./ports";

/**
 * SPEC 2026-11-01-sla-prioridades, sections 5.1 and 5.3 (decision P1): an attendant of the
 * sector changes the priority; the due date is recalculated from the start of the current
 * counting period, and a later due date allows new alerts (section 5.5).
 */
export async function changeRequestPriority(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<void> {
  const { requestId, priority } = validateInput(requestPriorityInputSchema, input);
  const authorized = await requireStatusChangeActor(requestId);

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(authorized.actorId);
    const request = await transaction.findLifecycleState(requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    assertCanChangePriority(actor, request, priority);

    const fromPriority = request.priority ?? "NORMAL";
    const currentDueAt = request.dueAt ?? null;
    const dueAt = dueAtAfterPriorityChange(currentDueAt, request.slaHoursSnapshot ?? null, fromPriority, priority);
    const occurredAt = await transaction.currentTime();
    const changed = await transaction.updatePriorityIfCurrent({
      requestId,
      expectedStatus: request.status,
      expectedAssigneeId: request.assignee?.id ?? null,
      expectedPriority: fromPriority,
      priority,
      dueAt,
      resetSlaAlerts: dueAt !== null && currentDueAt !== null && dueAt.getTime() > currentDueAt.getTime(),
      updatedAt: occurredAt,
    });

    // Status, assignee or priority changed after the read.
    if (changed !== 1) {
      throw new ConflictError();
    }

    await transaction.insertPriorityEvent({
      requestId,
      actorId: actor.id,
      fromPriority,
      toPriority: priority,
      occurredAt,
    });
    await transaction.recordEvent({
      type: "request.priority_changed",
      requestId,
      occurredAt,
      payload: { fromPriority, toPriority: priority, actorId: actor.id },
    });
  });
}
