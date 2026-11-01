"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assumeRequest,
  cancelRequest,
  changeRequestPriority,
  moveRequestStage,
  releaseRequest,
  transferRequest,
  transitionRequestStatus,
} from "@/modules/requests";
import { addComment } from "@/modules/comments";
import { scheduleEventProcessing } from "@/server/jobs/schedule";
import { ApplicationError, ValidationError } from "@/server/errors";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApplicationError, noteCode: string): string {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("note"))) {
    return noteCode;
  }
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("body"))) {
    return "body";
  }
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("priority"))) {
    return "priority";
  }
  return error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN"
    ? "access"
    : error.code === "NOT_FOUND"
      ? "missing"
      : error.code === "CONFLICT"
        ? "state"
        : error.code === "VALIDATION_ERROR"
          ? "validation"
          : "unexpected";
}

async function runOnRequest(
  formData: FormData,
  operation: (requestId: string) => Promise<unknown>,
  notice: string,
  /** Error code of a refused reason; each form with a reason has its own message. */
  noteCode = "note",
): Promise<never> {
  const requestId = field(formData, "requestId");

  try {
    await operation(requestId);
  } catch (error) {
    if (error instanceof ApplicationError) {
      redirect(`/queue/${encodeURIComponent(requestId)}?error=${errorCode(error, noteCode)}`);
    }

    throw error;
  }

  scheduleEventProcessing();
  revalidatePath("/queue");
  revalidatePath(`/queue/${requestId}`);
  redirect(`/queue/${requestId}?notice=${notice}`);
}

async function transition(
  formData: FormData,
  toStatus: "IN_PROGRESS" | "COMPLETED",
  notice: "started" | "completed",
): Promise<never> {
  return runOnRequest(formData, (requestId) => transitionRequestStatus({ requestId, toStatus }), notice);
}

export async function startRequestAction(formData: FormData): Promise<never> {
  return transition(formData, "IN_PROGRESS", "started");
}

export async function completeRequestAction(formData: FormData): Promise<never> {
  return transition(formData, "COMPLETED", "completed");
}

// Assignment within the sector (SPEC 2026-10-31, section 5.2). Only identifiers leave the
// form; the server checks the actor, the request and the new assignee.
export async function assumeRequestAction(formData: FormData): Promise<never> {
  return runOnRequest(formData, (requestId) => assumeRequest({ requestId }), "assumed");
}

export async function releaseRequestAction(formData: FormData): Promise<never> {
  return runOnRequest(formData, (requestId) => releaseRequest({ requestId }), "released");
}

export async function transferRequestAction(formData: FormData): Promise<never> {
  const assigneeId = field(formData, "assigneeId");
  return runOnRequest(
    formData,
    (requestId) => transferRequest({ requestId, assigneeId }),
    "transferred",
  );
}

// Section 5.4: the attendant cancels with a mandatory reason.
export async function cancelRequestAction(formData: FormData): Promise<never> {
  const note = field(formData, "note");
  return runOnRequest(formData, (requestId) => cancelRequest({ requestId, note }), "cancelled");
}

// Comments and internal notes (SPEC 2026-10-31-comentarios, decision C3).
export async function addCommentAction(formData: FormData): Promise<never> {
  const body = field(formData, "body");
  const isInternal = formData.get("isInternal") === "on";
  return runOnRequest(formData, (requestId) => addComment({ requestId, body, isInternal }), "commented");
}

// SPEC 2026-11-01-sla-prioridades, section 5.1 (decision P1).
export async function changePriorityAction(formData: FormData): Promise<never> {
  const priority = field(formData, "priority");
  return runOnRequest(formData, (requestId) => changeRequestPriority({ requestId, priority }), "priority");
}

// SPEC 2026-11-01-fluxos-configuraveis, section 5.3. The form sends the stage it shows; a move
// from another stage is refused as a conflict, so a double click never skips a stage.
function shownStageIndex(formData: FormData): number | string {
  const value = field(formData, "fromStageIndex");
  return /^\d+$/.test(value) ? Number(value) : value;
}

export async function advanceStageAction(formData: FormData): Promise<never> {
  const fromStageIndex = shownStageIndex(formData);
  return runOnRequest(
    formData,
    (requestId) => moveRequestStage({ requestId, direction: "advance", fromStageIndex }),
    "stage",
  );
}

export async function returnStageAction(formData: FormData): Promise<never> {
  const fromStageIndex = shownStageIndex(formData);
  const note = field(formData, "note");
  return runOnRequest(
    formData,
    (requestId) => moveRequestStage({ requestId, direction: "return", fromStageIndex, note }),
    "stage",
    "stage-note",
  );
}
