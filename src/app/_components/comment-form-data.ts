import { ValidationError, type ApplicationError } from "@/server/errors";
import { DocumentStorageError } from "@/server/storage";

// Files of the comment form (SPEC 2026-11-03-anexos-comentarios-documentos, 5.1), shared by the
// requester and the queue actions. Only the name and the bytes leave the form.

export const COMMENT_FILES_FIELD = "files";

/**
 * A file input left empty. Browsers send it as an empty file without a name, and the Server Action
 * decoding of this Next.js version delivers that name as the text "undefined" (seen in the E2E of
 * SF-125). A real file the person chose has its own name, so an empty one is still refused.
 */
export function isEmptyFileInput(value: File): boolean {
  return value.size === 0 && (value.name === "" || value.name === "undefined");
}

export async function commentFiles(formData: FormData): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const files = [];

  for (const value of formData.getAll(COMMENT_FILES_FIELD)) {
    if (typeof value === "string" || isEmptyFileInput(value)) continue;
    files.push({ name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
  }

  return files;
}

/** Error code of a refused comment file, or null when the error is not about files. */
export function commentFileErrorCode(error: ApplicationError): string | null {
  if (error instanceof DocumentStorageError) return "files-unavailable";
  if (error instanceof ValidationError && error.issues.some(({ path }) => path.includes("attachments"))) return "files";
  return null;
}

export const COMMENT_FILE_MESSAGES: Record<string, string> = {
  files: "Arquivos não aceitos: até 3 arquivos PDF, DOCX ou TXT por comentário, de até 2 MiB cada e 4 MiB somados, e no máximo 30 por solicitação.",
  "files-unavailable": "O envio de arquivos não está disponível agora. Envie o comentário sem arquivo ou tente mais tarde.",
};
