"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { openBundle } from "@/modules/requests";
import { FieldAnswersError } from "@/modules/service-fields";
import { ApplicationError } from "@/server/errors";
import { scheduleEventProcessing } from "@/server/jobs/schedule";

// Opening a bundle from the catalog (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 3). Refused
// answers go back as field ids and fixed codes, never as typed values, as in the opening of a
// service; the form keeps what was typed.

const CUSTOM_FIELD_PREFIX = "field.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function fieldValues(formData: FormData): { fieldValues?: Record<string, string | string[]> } {
  const values: Record<string, string | string[]> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(CUSTOM_FIELD_PREFIX) || typeof value !== "string") continue;
    const id = name.slice(CUSTOM_FIELD_PREFIX.length);
    const previous = values[id];
    values[id] = previous === undefined ? value : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return Object.keys(values).length > 0 ? { fieldValues: values } : {};
}

/** The query sent back to the bundle page for a refusal (internal: only async exports become actions). */
function bundleErrorQuery(error: ApplicationError): string {
  if (error instanceof FieldAnswersError) {
    if (error.reason === "stale_form") return "error=fields-changed";
    const list = error.fieldErrors.map(({ fieldId, code }) => `${fieldId}.${code}`).join(",");
    return `error=fields&fields=${encodeURIComponent(list)}`;
  }
  if (error.code === "VALIDATION_ERROR") return "error=validation";
  if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return "error=access";
  if (error.code === "NOT_FOUND" || error.code === "CONFLICT") return "error=unavailable";
  return "error=unexpected";
}

export async function openBundleAction(formData: FormData): Promise<never> {
  const bundleId = field(formData, "bundleId");
  let groupId: string;

  try {
    ({ groupId } = await openBundle({ bundleId, description: field(formData, "description"), ...fieldValues(formData) }));
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`/catalog/bundles/${encodeURIComponent(bundleId)}?${bundleErrorQuery(error)}`);
    throw error;
  }

  scheduleEventProcessing();
  revalidatePath("/requests");
  redirect(`/requests?notice=bundle-opened&group=${groupId}`);
}
