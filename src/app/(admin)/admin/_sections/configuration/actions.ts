"use server";

import { revalidatePath } from "next/cache";
import {
  MAX_CONFIGURATION_BYTES,
  applyConfigurationImport,
  previewConfigurationImport,
  type ImportPreview,
  type ItemStatus,
} from "@/modules/configuration";
import { ApplicationError } from "@/server/errors";

// The import from the administration (SPEC 2026-11-07-operacao-e-automacao, 6.3 items 4 and 5): the file is
// sent for the preview, which comes back to the form with the file's text; applying sends that same text and
// the digests the preview returned. Nothing travels in the address.

export type ImportState =
  | { step: "idle" }
  | { step: "preview"; preview: ImportPreview; content: string; fileName: string }
  | { step: "applied"; summary: Record<ItemStatus, number> }
  | { step: "error"; message: string };

const ERROR_MESSAGES = {
  missing: "Escolha um arquivo JSON exportado do ServiceFlow.",
  tooLarge: "O arquivo passa de 2 MB.",
  changed: "A configuração ou o arquivo mudou desde a prévia. Envie o arquivo de novo para uma nova prévia.",
  refused: "O arquivo não pode ser aplicado. Envie-o de novo para ver os problemas.",
  access: "Só o administrador importa a configuração.",
  unexpected: "Não foi possível concluir a importação. Nada foi gravado.",
} as const;

/**
 * A form sends text with its line breaks as CRLF, so the text kept for the application would not be the
 * previewed one byte for byte (and its digest would differ). Both steps use LF; in JSON line breaks are only
 * whitespace.
 */
const normalized = (text: string) => text.replace(/\r\n?/g, "\n");

function errorOf(error: ApplicationError): ImportState {
  if (error.code === "CONFLICT") return { step: "error", message: ERROR_MESSAGES.changed };
  if (error.code === "VALIDATION_ERROR") return { step: "error", message: ERROR_MESSAGES.refused };
  if (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN") return { step: "error", message: ERROR_MESSAGES.access };
  return { step: "error", message: ERROR_MESSAGES.unexpected };
}

export async function previewImportAction(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { step: "error", message: ERROR_MESSAGES.missing };
  if (file.size > MAX_CONFIGURATION_BYTES) return { step: "error", message: ERROR_MESSAGES.tooLarge };

  const content = normalized(await file.text());
  try {
    return { step: "preview", preview: await previewConfigurationImport(content), content, fileName: file.name };
  } catch (error) {
    if (error instanceof ApplicationError) return errorOf(error);
    throw error;
  }
}

export async function applyImportAction(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  try {
    const summary = await applyConfigurationImport({
      content: normalized(field("content")),
      digest: field("digest"),
      destinationDigest: field("destinationDigest"),
    });
    revalidatePath("/admin");
    return { step: "applied", summary };
  } catch (error) {
    if (error instanceof ApplicationError) return errorOf(error);
    throw error;
  }
}
