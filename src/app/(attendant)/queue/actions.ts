"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assumeRequest,
  releaseRequest,
  transferRequest,
  transitionRequestStatus,
} from "@/modules/requests";
import { ApplicationError } from "@/server/errors";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApplicationError): string {
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
): Promise<never> {
  const requestId = field(formData, "requestId");

  try {
    await operation(requestId);
  } catch (error) {
    if (error instanceof ApplicationError) {
      redirect(`/queue/${encodeURIComponent(requestId)}?error=${errorCode(error)}`);
    }

    throw error;
  }

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
