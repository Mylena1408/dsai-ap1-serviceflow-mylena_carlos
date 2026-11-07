import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import {
  approvalAfterDecision,
  assertCanDecideApproval,
  decisionNote,
  decisionOnBehalfOf,
  pendingApprovalSector,
} from "../domain/approval";
import { slaScheduleFrom } from "../domain/sla";
import { requestClock, scheduleColumns } from "./sla-clock";
import { requestApprovalDecisionInputSchema } from "./request-schemas";
import type { RequestTransactionRunner } from "./ports";

/**
 * A manager approves or rejects the pending level of a request (SPEC 2026-11-01-aprovacoes, sections
 * 5.3 to 5.6; levels: SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 and 4.3.4). Approving a
 * level that is not the last moves to the next one; approving the last starts the SLA; rejecting at
 * any level cancels the request with the note as its reason. The request only changes while it is
 * still open, pending and at the level read, so two simultaneous decisions never both count;
 * record, history and events are written in the same transaction.
 */
export async function decideApproval(input: unknown, transactions: RequestTransactionRunner): Promise<void> {
  const parsed = validateInput(requestApprovalDecisionInputSchema, input);
  const sessionActor = await requireCurrentActor();

  await transactions.run(async (transaction) => {
    const actor = await transaction.findActor(sessionActor.id);
    const request = await transaction.findLifecycleState(parsed.requestId);

    if (!actor || !request) {
      throw new NotFoundError();
    }

    const approvalRequest = {
      sectorId: request.sectorId,
      status: request.status,
      approvalState: request.approvalState ?? null,
      approvalSectorIdsSnapshot: request.approvalSectorIdsSnapshot ?? [],
      approvalLevel: request.approvalLevel ?? null,
      approvalPendingSectorId: request.approvalPendingSectorId ?? null,
    };
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5: a substitute also decides the
    // levels of the absent manager's sector, read in this transaction.
    const coverage = actor.role === "MANAGER" && transaction.approvalCoverage ? await transaction.approvalCoverage(actor.id) : [];
    assertCanDecideApproval(
      actor,
      approvalRequest,
      coverage.map(({ sectorId }) => sectorId),
    );
    const onBehalfOfId = decisionOnBehalfOf(actor.sectorId, pendingApprovalSector(approvalRequest), coverage);
    const note = decisionNote(parsed.decision, parsed.note);
    const decidedAt = await transaction.currentTime();
    const { level, next } = approvalAfterDecision(approvalRequest, parsed.decision);
    const finalApproval = parsed.decision === "APPROVED" && next === null;

    const changed = await transaction.updateApprovalIfCurrent({
      requestId: parsed.requestId,
      expectedLevel: approvalRequest.approvalLevel,
      updatedAt: decidedAt,
      ...(next
        ? // 4.3.3: the next level waits for its sector; the SLA has not started.
          { approvalState: "PENDING", approvalLevel: next.level, approvalPendingSectorId: next.sectorId }
        : finalApproval
          ? {
              approvalState: "APPROVED",
              ...(approvalRequest.approvalLevel === null ? {} : { approvalPendingSectorId: null }),
              ...scheduleColumns(
                // Section 5.5 (decision A3): from the last approval, on the request's clock
                // (SPEC 2026-11-03-pausa-sla-calendario, 5.2.5).
                request.slaHoursSnapshot === null || request.slaHoursSnapshot === undefined
                  ? null
                  : slaScheduleFrom(decidedAt, request.slaHoursSnapshot, request.priority ?? "NORMAL", await requestClock(transaction, request.slaBusinessHours)),
                request.slaBusinessHours,
              ),
            }
          : {
              approvalState: "REJECTED",
              ...(approvalRequest.approvalLevel === null ? {} : { approvalPendingSectorId: null }),
              status: "CANCELLED",
              cancelledAt: decidedAt,
            }),
    });

    if (changed !== 1) {
      throw new ConflictError();
    }

    await transaction.insertApproval({
      requestId: parsed.requestId,
      // Requests opened before levels take the column default, level 1.
      ...(approvalRequest.approvalLevel === null ? {} : { level }),
      ...(onBehalfOfId === null ? {} : { onBehalfOfId }),
      deciderId: actor.id,
      decision: parsed.decision,
      note,
      decidedAt,
    });

    if (parsed.decision === "REJECTED") {
      // Section 5.3.4: the rejection cancels the request, with the note as the reason.
      await transaction.insertStatusEvent({
        requestId: parsed.requestId,
        actorId: actor.id,
        fromStatus: "OPEN",
        toStatus: "CANCELLED",
        occurredAt: decidedAt,
        note,
      });
      await transaction.recordEvent({
        type: "request.status_changed",
        requestId: parsed.requestId,
        occurredAt: decidedAt,
        payload: { fromStatus: "OPEN", toStatus: "CANCELLED", actorId: actor.id },
      });
    }

    // The note stays in the record and the history only (SPEC de eventos, 6.1). The level and the
    // sector of the next level let the consumers tell an intermediate approval (decision G8).
    await transaction.recordEvent({
      type: "request.approval_decided",
      requestId: parsed.requestId,
      occurredAt: decidedAt,
      payload: { decision: parsed.decision, actorId: actor.id, level, nextSectorId: next?.sectorId ?? null },
    });
  });
}
