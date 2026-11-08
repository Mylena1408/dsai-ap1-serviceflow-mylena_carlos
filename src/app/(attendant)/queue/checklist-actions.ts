"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markChecklistItem } from "@/modules/checklists";
import { ApplicationError } from "@/server/errors";

// A request's checklist from the attendant's detail (SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1
// item 4). Each refusal comes back as a fixed code, shown by the page.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The page's message for each refusal (not exported, so it may be synchronous in a "use server" file). */
function checklistErrorCode(error: ApplicationError): string {
  if (error.code === "VALIDATION_ERROR") return "checklist-note";
  if (error.code === "CONFLICT") return "checklist-state";
  return "missing";
}

export async function markChecklistItemAction(formData: FormData): Promise<never> {
  const requestId = field(formData, "requestId");
  const done = field(formData, "done") === "true";
  try {
    await markChecklistItem({ requestId, itemId: field(formData, "itemId"), done, note: done ? field(formData, "note") : null });
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`/queue/${encodeURIComponent(requestId)}?error=${checklistErrorCode(error)}#checklist`);
    throw error;
  }
  revalidatePath(`/queue/${requestId}`);
  redirect(`/queue/${requestId}?notice=${done ? "checklist-done" : "checklist-undone"}#checklist`);
}
