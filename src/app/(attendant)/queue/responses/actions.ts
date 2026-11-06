"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCannedResponse, setCannedResponseActive, updateCannedResponse } from "@/modules/canned-responses";
import { ApplicationError, ValidationError } from "@/server/errors";

// Actions of "Respostas prontas" (SPEC 2026-11-06-respostas-prontas, 4.1 to 4.5): every rule is
// checked again by the use cases; the page only shows the outcome.

const PAGE = "/queue/responses";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError) return "invalid";
  return error.code === "CONFLICT" ? "duplicate" : "missing";
}

async function run(operation: () => Promise<unknown>, notice: string): Promise<never> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${PAGE}?error=${errorCode(error)}`);
    throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${notice}`);
}

export async function createCannedResponseAction(formData: FormData): Promise<never> {
  return run(() => createCannedResponse({ title: field(formData, "title"), body: field(formData, "body") }), "created");
}

export async function updateCannedResponseAction(formData: FormData): Promise<never> {
  return run(
    () => updateCannedResponse(field(formData, "id"), { title: field(formData, "title"), body: field(formData, "body") }),
    "updated",
  );
}

export async function setCannedResponseActiveAction(formData: FormData): Promise<never> {
  const active = field(formData, "active") === "true";
  return run(() => setCannedResponseActive(field(formData, "id"), active), active ? "activated" : "deactivated");
}
