"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LIST_PATHS, deleteView, normalizedCriteria, renameView, saveView, type SavedViewList } from "@/modules/saved-views";
import { ApplicationError, ValidationError } from "@/server/errors";

// Saved views from the queue and from "Minhas solicitações" (SPEC 2026-11-07-operacao-e-automacao, 7.3 item
// 1). The page to go back to is the list's own, with the search that was on screen, normalized again here:
// never an address from the form.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function listOf(formData: FormData): SavedViewList {
  return field(formData, "list") === "MY_REQUESTS" ? "MY_REQUESTS" : "QUEUE";
}

function errorCode(error: ApplicationError): string {
  if (error instanceof ValidationError && error.issues.some(({ path, code }) => path.length === 0 && code === "too_big")) return "view-limit";
  if (error.code === "CONFLICT") return "view-taken";
  if (error.code === "VALIDATION_ERROR") return "view-name";
  return "view-missing";
}

async function run(formData: FormData, work: () => Promise<unknown>, notice: string): Promise<never> {
  const list = listOf(formData);
  const back = normalizedCriteria(list, field(formData, "back"));
  const page = (code: string) => `${LIST_PATHS[list]}?${back ? `${back}&` : ""}view=${code}`;
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) redirect(page(errorCode(error)));
    throw error;
  }
  revalidatePath(LIST_PATHS[list]);
  redirect(page(notice));
}

export async function saveViewAction(formData: FormData): Promise<never> {
  return run(formData, () => saveView({ list: listOf(formData), name: field(formData, "name"), criteria: field(formData, "back") }), "view-saved");
}

export async function renameViewAction(formData: FormData): Promise<never> {
  return run(formData, () => renameView(field(formData, "viewId"), field(formData, "name")), "view-renamed");
}

export async function deleteViewAction(formData: FormData): Promise<never> {
  return run(formData, () => deleteView(field(formData, "viewId")), "view-deleted");
}
