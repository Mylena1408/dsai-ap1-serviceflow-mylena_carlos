import { requireStatusChangeActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { requestStatusTransitionInputSchema } from "./request-schemas";
import type { RequestWithHistory } from "../domain/request";
import { assertCanChangeStatusWithAssignee } from "../domain/lifecycle";
import { completedLateAt } from "../domain/sla";
import {
  assertCanCompleteAtStage,
  stageCopyFromSettings,
  stageCopyOnStart,
  stageDueAtFrom,
  stageTargetDaysAt,
  type StageDetails,
} from "../domain/stages";
import { assertCanStartWithApproval } from "../domain/approval";
import { assignStageAttendant } from "./stage-entry";
import { assertRequestStatusTransition } from "../domain/status-transition";
import type { RequestTransactionRunner } from "./ports";
import { closePause, resumeColumns } from "./sla-pause";
import { assertAttendanceFieldsComplete } from "./attendance-fields";
import { readRequestAfterWrite } from "./read-after-write";
import { assertChecklistAllowsCompletion, planChecklistCopy } from "@/modules/checklists";

export async function transitionRequestStatus(
  input: unknown,
  transactions: RequestTransactionRunner,
): Promise<RequestWithHistory> {
  const parsed = validateInput(requestStatusTransitionInputSchema, input);
  const authorizedActor = await requireStatusChangeActor(parsed.requestId);

  await transactions.run(async (transaction) => {
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
    const stageState = {
      status: currentRequest.status,
      stageNamesSnapshot: currentRequest.stageNamesSnapshot ?? [],
      stageIndex: currentRequest.stageIndex ?? null,
    };
    // SPEC 2026-11-01-fluxos-configuraveis: a request with a flow is completed only at its last
    // stage (5.3.3); starting copies the active stages and enters the first one (5.2.2).
    if (parsed.toStatus === "COMPLETED") {
      assertCanCompleteAtStage(stageState);
      // SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.4.
      await assertAttendanceFieldsComplete(transaction, parsed.requestId, currentRequest.serviceId);
      // SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 items 4 and 5 (decision I8): in the same transaction, the
      // required checklist items still to mark refuse the completion; without a checklist, it goes on.
      if (transaction.listChecklistItems) {
        assertChecklistAllowsCompletion(await transaction.listChecklistItems(parsed.requestId));
      }
    }
    // SPEC 2026-11-01-aprovacoes, 5.3.2: nobody starts while the approval is pending.
    if (parsed.toStatus === "IN_PROGRESS") {
      assertCanStartWithApproval(currentRequest.approvalState ?? null);
    }
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3 and 5.4: with the settings, only the stages
    // whose condition the opening answers meet, with their attendant and target.
    const stageCopy =
      parsed.toStatus === "IN_PROGRESS" && currentRequest.serviceId
        ? transaction.listActiveStages && transaction.listOpeningAnswers
          ? stageCopyFromSettings(
              await transaction.listActiveStages(currentRequest.serviceId),
              await transaction.listOpeningAnswers(parsed.requestId),
            )
          : stageCopyOnStart(await transaction.listActiveStageNames(currentRequest.serviceId))
        : null;
    const occurredAt = await transaction.currentTime();
    // 5.3.2: the first stage's target starts with the attendance.
    const firstStageDue =
      stageCopy && stageCopy.stageIndex !== null
        ? stageDueAtFrom(occurredAt, stageTargetDaysAt(stageCopy as Partial<StageDetails>, 0))
        : null;
    // SPEC 2026-11-03-pausa-sla-calendario, 5.4.3: completing ends a running pause first, so the
    // paused time does not make the completion late.
    const ending = parsed.toStatus === "COMPLETED" ? await resumeColumns(transaction, currentRequest, occurredAt) : null;
    const changed = await transaction.updateStatusIfCurrent({
      requestId: parsed.requestId,
      sectorId: currentActor.sectorId,
      expectedStatus: currentRequest.status,
      expectedAssigneeId: currentRequest.assignee?.id ?? null,
      toStatus: parsed.toStatus,
      updatedAt: occurredAt,
      ...(parsed.toStatus === "COMPLETED"
        ? {
            completedAt: occurredAt,
            completedLate: completedLateAt(ending ? ending.dueAt : (currentRequest.dueAt ?? null), occurredAt),
            ...(stageState.stageIndex !== null ? { expectedStageIndex: stageState.stageIndex } : {}),
          }
        : {}),
      ...(stageCopy && stageCopy.stageIndex !== null ? stageCopy : {}),
      ...(firstStageDue ? { stageDueAt: firstStageDue, stageOverdueNotifiedAt: null } : {}),
      ...(ending ? { ...ending, expectedSlaPausedAt: currentRequest.slaPausedAt ?? null } : {}),
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

    if (ending) {
      await closePause(transaction, parsed.requestId, occurredAt, currentActor.id, "ATTENDANCE_ENDED");
    }

    // SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 2 and 13.1 item 1 (decision I5): the first start copies the
    // service's active checklist items whose condition the opening answers meet; reopening and starting again
    // does not copy anew.
    if (
      parsed.toStatus === "IN_PROGRESS" &&
      currentRequest.serviceId &&
      transaction.hasChecklist &&
      transaction.listChecklistModel &&
      transaction.insertChecklist &&
      !(await transaction.hasChecklist(parsed.requestId))
    ) {
      const model = await transaction.listChecklistModel(currentRequest.serviceId);
      const answers = model.some((item) => item.conditionFieldId !== null) && transaction.listOpeningAnswers
        ? await transaction.listOpeningAnswers(parsed.requestId)
        : [];
      await transaction.insertChecklist(parsed.requestId, occurredAt, planChecklistCopy(model, answers));
    }

    if (stageCopy && stageCopy.stageIndex !== null) {
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1: the first stage's attendant receives it.
      const entry = await assignStageAttendant(transaction, {
        requestId: parsed.requestId,
        requestSectorId: currentRequest.sectorId,
        details: stageCopy as Partial<StageDetails>,
        stageIndex: 0,
        currentAssigneeId: currentRequest.assignee?.id ?? null,
        actorId: currentActor.id,
        at: occurredAt,
      });
      const stageEventId = await transaction.insertStageEvent({
        requestId: parsed.requestId,
        actorId: currentActor.id,
        fromStage: null,
        toStage: stageCopy.stageNamesSnapshot[0],
        note: null,
        occurredAt,
        ...(entry.unavailable ? { assigneeUnavailable: true } : {}),
      });
      await transaction.recordEvent({
        type: "request.stage_changed",
        requestId: parsed.requestId,
        occurredAt,
        payload: { stageEventId, direction: "start", actorId: currentActor.id },
      });
    }

  });

  // SPEC 2026-11-06-transacao-abertura: the history is read after the commit, outside the write.
  return readRequestAfterWrite(transactions, parsed.requestId);
}
