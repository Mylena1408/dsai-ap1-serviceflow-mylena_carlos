"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteTimeEntry, logTime, updateTimeEntry } from "@/modules/time-entries";
import { ApplicationError, ValidationError } from "@/server/errors";

// Time on a request, from the attendant's detail (SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 items 1 to 3). Each
// refusal comes back as a fixed code, shown by the page.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** A whole number from the form; anything else is sent as is, for the validation to refuse. */
function whole(formData: FormData, name: string): number | string {
  const value = field(formData, name).trim();
  return /^\d{1,3}$/.test(value) ? Number(value) : value;
}

/** The page's message for each refusal (not exported, so it may be synchronous in a "use server" file). */
function timeErrorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("workedOn"))) return "time-day";
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("note"))) return "time-note";
  if (error.code === "VALIDATION_ERROR") return "time-duration";
  if (error.code === "CONFLICT") return "time-state";
  return "missing";
}

async function run(formData: FormData, work: () => Promise<unknown>, notice: string): Promise<never> {
  const requestId = field(formData, "requestId");
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`/queue/${encodeURIComponent(requestId)}?error=${timeErrorCode(error)}#time`);
    throw error;
  }
  revalidatePath(`/queue/${requestId}`);
  redirect(`/queue/${requestId}?notice=${notice}#time`);
}

const values = (formData: FormData) => ({
  workedOn: field(formData, "workedOn"),
  hours: whole(formData, "hours"),
  minutes: whole(formData, "minutes"),
  note: field(formData, "note"),
});

export async function logTimeAction(formData: FormData): Promise<never> {
  return run(formData, () => logTime({ requestId: field(formData, "requestId"), ...values(formData) }), "time-logged");
}

export async function updateTimeEntryAction(formData: FormData): Promise<never> {
  return run(formData, () => updateTimeEntry(field(formData, "entryId"), values(formData)), "time-updated");
}

export async function deleteTimeEntryAction(formData: FormData): Promise<never> {
  return run(formData, () => deleteTimeEntry(field(formData, "entryId")), "time-deleted");
}
