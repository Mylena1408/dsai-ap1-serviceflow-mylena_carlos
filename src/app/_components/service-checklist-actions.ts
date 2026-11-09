"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { copyChecklistModel, createChecklistItem, moveChecklistItem, setChecklistItemActive, setChecklistItemCondition, updateChecklistItem } from "@/modules/checklists";
import { ApplicationError, ValidationError } from "@/server/errors";

// The services' checklist models from the administration and the manager's area (SPEC
// 2026-11-08-atendimento-dia-a-dia, 4.3 item 1). The page to go back to is one of the known ones, never an
// address from the form.

const PAGES = { approvals: "/approvals/checklists", admin: "/admin?section=checklists" } as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pageOf(formData: FormData): string {
  return field(formData, "area") === "admin" ? PAGES.admin : PAGES.approvals;
}

/** The message code of a refusal (internal: only async exports become actions). */
function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path, code }) => path.length === 0 && code === "too_big")) return "checklist-limit";
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("conditionFieldId") || path.includes("conditionValue"))) {
    return "checklist-condition";
  }
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("sourceServiceId"))) return "checklist-source";
  if (error.code === "CONFLICT") return "checklist-conflict";
  if (error.code === "VALIDATION_ERROR") return "checklist-invalid";
  return "checklist-missing";
}

async function run(formData: FormData, work: () => Promise<unknown>, notice: string): Promise<never> {
  const page = pageOf(formData);
  const separator = page.includes("?") ? "&" : "?";
  // The service whose block opens again; only a well-formed id goes back to the address.
  const service = field(formData, "serviceId");
  const open = /^[0-9a-f-]{36}$/i.test(service) ? `&open=${service}` : "";
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${page}${separator}checklist=${errorCode(error)}${open}`);
    throw error;
  }
  revalidatePath(page.split("?")[0]);
  redirect(`${page}${separator}checklist=${notice}${open}`);
}

const itemInput = (formData: FormData) => ({ text: field(formData, "text"), isRequired: field(formData, "isRequired") === "true" });

export async function createChecklistItemAction(formData: FormData): Promise<never> {
  return run(formData, () => createChecklistItem(field(formData, "serviceId"), itemInput(formData)), "checklist-created");
}

export async function updateChecklistItemAction(formData: FormData): Promise<never> {
  return run(formData, () => updateChecklistItem(field(formData, "itemId"), itemInput(formData)), "checklist-updated");
}

export async function moveChecklistItemAction(formData: FormData): Promise<never> {
  return run(formData, () => moveChecklistItem(field(formData, "itemId"), field(formData, "direction")), "checklist-moved");
}

export async function setChecklistItemActiveAction(formData: FormData): Promise<never> {
  const active = field(formData, "isActive") === "true";
  return run(formData, () => setChecklistItemActive(field(formData, "itemId"), active), active ? "checklist-reactivated" : "checklist-deactivated");
}

/** 13.1 item 1: the form sends "<field id>|<value>", or nothing for "always". */
export async function setChecklistItemConditionAction(formData: FormData): Promise<never> {
  const choice = field(formData, "condition");
  const separator = choice.indexOf("|");
  const condition =
    choice === ""
      ? { conditionFieldId: null, conditionValue: null }
      : separator > 0
        ? { conditionFieldId: choice.slice(0, separator), conditionValue: choice.slice(separator + 1) }
        : { conditionFieldId: choice, conditionValue: null };
  return run(formData, () => setChecklistItemCondition(field(formData, "itemId"), condition), "checklist-condition-saved");
}

/** 13.1 item 2 (decision J2). */
export async function copyChecklistModelAction(formData: FormData): Promise<never> {
  return run(formData, () => copyChecklistModel(field(formData, "serviceId"), field(formData, "sourceServiceId")), "checklist-copied");
}
