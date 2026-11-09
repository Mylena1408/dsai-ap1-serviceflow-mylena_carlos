"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addFollower, removeFollower } from "@/modules/followers";
import { ApplicationError, ValidationError } from "@/server/errors";

// Following a request from the requester's detail, the queue's detail and the colleague's page (SPEC
// 2026-11-08-atendimento-dia-a-dia, 6.3 item 1). The page to go back to is one of the known ones, built from the
// request's id, never an address from the form.

const AREAS = {
  requester: (id: string) => `/requests/${id}`,
  queue: (id: string) => `/queue/${id}`,
  following: (id: string) => `/requests/following/${id}`,
} as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pageOf(formData: FormData, requestId: string): string {
  const area = field(formData, "area");
  const build = area === "queue" || area === "following" ? AREAS[area] : AREAS.requester;
  return build(encodeURIComponent(requestId));
}

/** The message code of a refusal (internal: only async exports become actions). */
function followErrorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ code }) => code === "too_big")) return "follow-limit";
  if (error.code === "VALIDATION_ERROR") return "follow-invalid";
  if (error.code === "CONFLICT") return "follow-conflict";
  return "follow-missing";
}

async function run(formData: FormData, work: (requestId: string) => Promise<unknown>, notice: string, after?: string): Promise<never> {
  const requestId = field(formData, "requestId");
  const page = pageOf(formData, requestId);
  try {
    await work(requestId);
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${page}?follow=${followErrorCode(error)}#followers`);
    throw error;
  }
  revalidatePath(page);
  redirect(after ?? `${page}?follow=${notice}#followers`);
}

/** The requester adds a colleague by their e-mail. */
export async function addColleagueAction(formData: FormData): Promise<never> {
  return run(formData, (requestId) => addFollower({ requestId, email: field(formData, "email") }), "follow-added");
}

/** An attendant of the sector follows the request. */
export async function followRequestAction(formData: FormData): Promise<never> {
  return run(formData, (requestId) => addFollower({ requestId }), "follow-following");
}

/** The requester removes a colleague; anyone who follows stops following. */
export async function removeFollowerAction(formData: FormData): Promise<never> {
  const self = field(formData, "self") === "true";
  // A colleague who stops following no longer reads the request: back to the list of what they follow.
  const after = self && field(formData, "area") === "following" ? "/requests/following?follow=follow-stopped" : undefined;
  return run(formData, (requestId) => removeFollower({ requestId, userId: field(formData, "userId") }), self ? "follow-stopped" : "follow-removed", after);
}
