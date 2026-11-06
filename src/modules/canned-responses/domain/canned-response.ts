import { z } from "zod";

// Canned responses of a sector (SPEC 2026-11-06-respostas-prontas, 4): limits, input schemas and
// the replacement of the four fields when a response is inserted into a comment.

export const MAX_CANNED_TITLE_LENGTH = 120;
export const MAX_CANNED_BODY_LENGTH = 5_000;

export const cannedResponseInputSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_CANNED_TITLE_LENGTH),
    body: z.string().refine((value) => value.trim().length > 0, { message: "required" }).pipe(z.string().max(MAX_CANNED_BODY_LENGTH)),
  })
  .strict();

export type CannedResponseInput = z.infer<typeof cannedResponseInputSchema>;

export interface CannedResponseValues {
  requesterName: string;
  serviceName: string;
  shortCode: string;
  attendantName: string;
}

/** First word of a name: the greeting uses the first name (4.2 of the SPEC, field {{solicitante}}). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

const FIELDS: Record<string, (values: CannedResponseValues) => string> = {
  solicitante: (values) => firstName(values.requesterName),
  servico: (values) => values.serviceName,
  codigo: (values) => values.shortCode,
  atendente: (values) => values.attendantName,
};

/**
 * Replaces the known fields; unknown ones stay as written (4.4). Spaces inside the braces are
 * tolerated, and the field names are matched without case.
 */
export function renderCannedResponse(body: string, values: CannedResponseValues): string {
  return body.replace(/\{\{\s*([a-zA-ZçÇ]+)\s*\}\}/g, (match, name: string) => {
    const field = FIELDS[name.toLowerCase()];
    return field ? field(values) : match;
  });
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

export function compareTitles(left: { title: string }, right: { title: string }): number {
  return collator.compare(left.title, right.title);
}
