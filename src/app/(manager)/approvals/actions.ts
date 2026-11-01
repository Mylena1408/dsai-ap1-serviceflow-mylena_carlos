"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideApproval } from "@/modules/requests";
import { scheduleEventProcessing } from "@/server/jobs/schedule";
import { ApplicationError, ValidationError } from "@/server/errors";

// Manager decision (SPEC 2026-11-01-aprovacoes, 5.4).

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("note"))) return "note";
  if (error.code === "CONFLICT") return "decided";
  if (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "missing";
  return error.code === "VALIDATION_ERROR" ? "validation" : "unexpected";
}

async function decide(formData: FormData, decision: "APPROVED" | "REJECTED"): Promise<never> {
  const requestId = field(formData, "requestId");

  try {
    await decideApproval({ requestId, decision, note: field(formData, "note") });
  } catch (error) {
    if (error instanceof ApplicationError) {
      redirect(`/approvals/${encodeURIComponent(requestId)}?error=${errorCode(error)}`);
    }

    throw error;
  }

  scheduleEventProcessing();
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${requestId}`);
  redirect(`/approvals/${requestId}?notice=${decision === "APPROVED" ? "approved" : "rejected"}`);
}

export async function approveRequestAction(formData: FormData): Promise<never> {
  return decide(formData, "APPROVED");
}

export async function rejectRequestAction(formData: FormData): Promise<never> {
  return decide(formData, "REJECTED");
}
