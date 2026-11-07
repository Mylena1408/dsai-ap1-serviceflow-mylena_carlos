import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { assertCanMoveStage } from "../domain/lifecycle";
import { planStageMove } from "../domain/stages";
import { requestStageMoveInputSchema } from "./request-schemas";
import { assignStageAttendant, stageEntryDue } from "./stage-entry";
import type { RequestTransactionRunner } from "./ports";

/**
 * Advances or returns one stage of the flow copy (SPEC 2026-11-01-fluxos-configuraveis, 5.3
 * and 5.5). The actor and the request are reloaded in the transaction; the stage only moves
 * from the stage the person saw and while status, assignee and stage are still the ones read,
 * and the history row and the outbox event are written in the same transaction.
 */
export async function moveRequestStage(input: unknown, transactions: RequestTransactionRunner): Promise<void> {
  const parsed = validateInput(requestStageMoveInputSchema, input);
  const sessionActor = await requireCurrentActor();

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(sessionActor.id);
    const request = await transaction.findLifecycleState(parsed.requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    assertCanMoveStage(actor, request);

    // The stage changed since the person saw it (section 5.3.5).
    if ((request.stageIndex ?? null) !== parsed.fromStageIndex) {
      throw new ConflictError();
    }

    const move = planStageMove(
      {
        status: request.status,
        stageNamesSnapshot: request.stageNamesSnapshot ?? [],
        stageIndex: request.stageIndex ?? null,
      },
      parsed.direction,
      parsed.note,
    );
    const occurredAt = await transaction.currentTime();
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3: the stage entered has its own due date
    // and, when it has an attendant, the request goes to them.
    const details = { stageAssigneeIdsSnapshot: request.stageAssigneeIdsSnapshot, stageTargetDaysSnapshot: request.stageTargetDaysSnapshot };
    const changed = await transaction.updateStageIfCurrent({
      requestId: parsed.requestId,
      expectedAssigneeId: request.assignee?.id ?? null,
      expectedStageIndex: move.fromIndex,
      stageIndex: move.toIndex,
      updatedAt: occurredAt,
      ...stageEntryDue(details, move.toIndex, occurredAt),
    });

    if (changed !== 1) {
      throw new ConflictError();
    }

    const entry = await assignStageAttendant(transaction, {
      requestId: parsed.requestId,
      requestSectorId: request.sectorId,
      details,
      stageIndex: move.toIndex,
      currentAssigneeId: request.assignee?.id ?? null,
      actorId: actor.id,
      at: occurredAt,
    });
    const stageEventId = await transaction.insertStageEvent({
      requestId: parsed.requestId,
      actorId: actor.id,
      fromStage: move.fromStage,
      toStage: move.toStage,
      note: move.note,
      occurredAt,
      ...(entry.unavailable ? { assigneeUnavailable: true } : {}),
    });
    await transaction.recordEvent({
      type: "request.stage_changed",
      requestId: parsed.requestId,
      occurredAt,
      payload: { stageEventId, direction: parsed.direction, actorId: actor.id },
    });
  });
}
