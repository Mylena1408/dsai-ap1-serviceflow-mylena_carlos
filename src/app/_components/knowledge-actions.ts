"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createArticle, deleteArticle, setArticlePublished, updateArticle } from "@/modules/knowledge";
import { ApplicationError, ValidationError } from "@/server/errors";

// Actions of the knowledge base editor (SPEC 2026-11-06-base-conhecimento, 4.3 and 4.4), used by
// the administration and by "Serviços do setor". The use cases check every rule again.

const RETURN_PAGES = new Set(["/admin?section=knowledge", "/sector-services"]);

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function page(formData: FormData): string {
  const requested = field(formData, "returnTo");
  return RETURN_PAGES.has(requested) ? requested : "/admin?section=knowledge";
}

function separator(path: string): string {
  return path.includes("?") ? "&" : "?";
}

async function run(formData: FormData, operation: () => Promise<unknown>, notice: string): Promise<never> {
  const target = page(formData);
  try {
    await operation();
  } catch (error) {
    if (error instanceof ApplicationError) {
      const code = error instanceof ValidationError ? "article-invalid" : error.code === "CONFLICT" ? "article-conflict" : "article-missing";
      redirect(`${target}${separator(target)}knowledge=${code}#knowledge`);
    }
    throw error;
  }
  revalidatePath(target.split("?")[0]!);
  redirect(`${target}${separator(target)}knowledge=${notice}#knowledge`);
}

function articleInput(formData: FormData) {
  const position = field(formData, "position");
  return { title: field(formData, "title"), body: field(formData, "body"), ...(position === "" ? {} : { position }) };
}

export async function createArticleAction(formData: FormData): Promise<never> {
  return run(formData, () => createArticle(field(formData, "serviceId"), articleInput(formData)), "article-created");
}

export async function updateArticleAction(formData: FormData): Promise<never> {
  return run(formData, () => updateArticle(field(formData, "id"), articleInput(formData)), "article-updated");
}

export async function publishArticleAction(formData: FormData): Promise<never> {
  const publish = field(formData, "publish") === "true";
  return run(formData, () => setArticlePublished(field(formData, "id"), publish), publish ? "article-published" : "article-unpublished");
}

export async function deleteArticleAction(formData: FormData): Promise<never> {
  return run(formData, () => deleteArticle(field(formData, "id")), "article-deleted");
}
