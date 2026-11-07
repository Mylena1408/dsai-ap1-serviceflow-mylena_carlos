"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { linkRequests, unlinkRequests } from "@/modules/requests";
import { ApplicationError } from "@/server/errors";

// Links between requests, from the attendant's detail (SPEC 2026-11-07-operacao-e-automacao, 3.3
// item 1). Each refusal comes back as a fixed code, shown by the page.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function run(formData: FormData, work: (requestId: string) => Promise<unknown>, notice: string): Promise<never> {
  const requestId = field(formData, "requestId");
  try {
    await work(requestId);
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`/queue/${encodeURIComponent(requestId)}?error=${linkErrorCode(error.code)}`);
    throw error;
  }
  revalidatePath(`/queue/${requestId}`);
  redirect(`/queue/${requestId}?notice=${notice}`);
}

/** The page's message for each refusal (not exported, so it may be synchronous in a "use server" file). */
function linkErrorCode(code: ApplicationError["code"]): string {
  return code === "VALIDATION_ERROR" ? "link-code" : code === "NOT_FOUND" ? "link-missing" : code === "CONFLICT" ? "link-conflict" : "unexpected";
}

export async function linkRequestAction(formData: FormData): Promise<never> {
  return run(
    formData,
    (requestId) => linkRequests({ requestId, code: field(formData, "code"), kind: field(formData, "kind") }),
    "linked",
  );
}

export async function unlinkRequestAction(formData: FormData): Promise<never> {
  return run(formData, (requestId) => unlinkRequests({ requestId, linkId: field(formData, "linkId") }), "unlinked");
}
