import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { assertCanDecideApproval, decisionNote, dueAtOnApproval } from "../domain/approval";
import { requestApprovalDecisionInputSchema } from "./request-schemas";
import type { RequestTransactionRunner } from "./ports";

/**
 * A manager of the sector approves or rejects a pending request (SPEC 2026-11-01-aprovacoes,
 * sections 5.3 to 5.6). Approving starts the SLA; rejecting cancels the request with the note as
 * its reason. The request only changes while it is still open and pending, so two simultaneous
 * decisions never both count; record, history and events are written in the same transaction.
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

    assertCanDecideApproval(actor, {
      sectorId: request.sectorId,
      status: request.status,
      approvalState: request.approvalState ?? null,
    });
    const note = decisionNote(parsed.decision, parsed.note);
    const decidedAt = await transaction.currentTime();
    const approved = parsed.decision === "APPROVED";

    const changed = await transaction.updateApprovalIfCurrent({
      requestId: parsed.requestId,
      approvalState: approved ? "APPROVED" : "REJECTED",
      updatedAt: decidedAt,
      ...(approved
        ? { dueAt: dueAtOnApproval(decidedAt, request.slaHoursSnapshot ?? null, request.priority ?? "NORMAL") }
        : { status: "CANCELLED", cancelledAt: decidedAt }),
    });

    if (changed !== 1) {
      throw new ConflictError();
    }

    await transaction.insertApproval({
      requestId: parsed.requestId,
      deciderId: actor.id,
      decision: parsed.decision,
      note,
      decidedAt,
    });

    if (!approved) {
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

    // The note stays in the record and the history only (SPEC de eventos, 6.1).
    await transaction.recordEvent({
      type: "request.approval_decided",
      requestId: parsed.requestId,
      occurredAt: decidedAt,
      payload: { decision: parsed.decision, actorId: actor.id },
    });
  });
}
