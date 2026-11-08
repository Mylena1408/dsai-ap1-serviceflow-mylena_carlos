"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeRequestTags } from "@/modules/tags";
import { ApplicationError, ValidationError } from "@/server/errors";

// Tags on a request, from the attendant's detail (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 2). Each
// refusal comes back as a fixed code, shown by the page.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The page's message for each refusal (not exported, so it may be synchronous in a "use server" file). */
function tagErrorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ code }) => code === "too_big")) return "tag-limit";
  if (error.code === "VALIDATION_ERROR") return "tag-invalid";
  if (error.code === "CONFLICT") return "tag-state";
  return "missing";
}

async function run(formData: FormData, change: { add: string[]; remove: string[] }, notice: string): Promise<never> {
  const requestId = field(formData, "requestId");
  try {
    await changeRequestTags({ requestId, ...change });
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`/queue/${encodeURIComponent(requestId)}?error=${tagErrorCode(error)}`);
    throw error;
  }
  revalidatePath(`/queue/${requestId}`);
  redirect(`/queue/${requestId}?notice=${notice}`);
}

export async function addRequestTagAction(formData: FormData): Promise<never> {
  return run(formData, { add: [field(formData, "tagId")], remove: [] }, "tagged");
}

export async function removeRequestTagAction(formData: FormData): Promise<never> {
  return run(formData, { add: [], remove: [field(formData, "tagId")] }, "untagged");
}
