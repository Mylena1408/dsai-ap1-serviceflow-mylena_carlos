"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSectorTag, setSectorTagActive, updateSectorTag } from "@/modules/tags";
import { ApplicationError, ValidationError } from "@/server/errors";

// The sectors' tags from the administration and the manager's area (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3
// item 1). The page to go back to is one of the known ones, never an address from the form.

const PAGES = { approvals: "/approvals/tags", admin: "/admin?section=tags" } as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pageOf(formData: FormData): string {
  return field(formData, "area") === "admin" ? PAGES.admin : PAGES.approvals;
}

/** The message code of a refusal (internal: only async exports become actions). */
function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path, code }) => path.length === 0 && code === "too_big")) return "tag-limit";
  if (error.code === "CONFLICT") return "tag-taken";
  if (error.code === "VALIDATION_ERROR") return "tag-invalid";
  return "tag-missing";
}

async function run(formData: FormData, work: () => Promise<unknown>, notice: string): Promise<never> {
  const page = pageOf(formData);
  const separator = page.includes("?") ? "&" : "?";
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`${page}${separator}tag=${errorCode(error)}`);
    throw error;
  }
  revalidatePath(page.split("?")[0]);
  redirect(`${page}${separator}tag=${notice}`);
}

const tagInput = (formData: FormData) => ({ name: field(formData, "name"), color: field(formData, "color") });

export async function createSectorTagAction(formData: FormData): Promise<never> {
  return run(formData, () => createSectorTag(field(formData, "sectorId"), tagInput(formData)), "tag-created");
}

export async function updateSectorTagAction(formData: FormData): Promise<never> {
  return run(formData, () => updateSectorTag(field(formData, "tagId"), tagInput(formData)), "tag-updated");
}

export async function setSectorTagActiveAction(formData: FormData): Promise<never> {
  const active = field(formData, "isActive") === "true";
  return run(formData, () => setSectorTagActive(field(formData, "tagId"), active), active ? "tag-reactivated" : "tag-deactivated");
}
