import { z } from "zod";

// Knowledge base articles (SPEC 2026-11-06-base-conhecimento, 4): limits, input schema and the
// order shown to requesters.

export const MAX_ARTICLE_TITLE_LENGTH = 160;
export const MAX_ARTICLE_BODY_LENGTH = 20_000;
export const MAX_ARTICLE_POSITION = 999;

export const articleInputSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_ARTICLE_TITLE_LENGTH),
    body: z.string().refine((value) => value.trim().length > 0, { message: "required" }).pipe(z.string().max(MAX_ARTICLE_BODY_LENGTH)),
    position: z.coerce.number().int().min(0).max(MAX_ARTICLE_POSITION).optional(),
  })
  .strict();

export type ArticleInput = z.infer<typeof articleInputSchema>;

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Position first, then title (4.2, decision K7). */
export function compareArticles(left: { position: number; title: string }, right: { position: number; title: string }): number {
  return left.position - right.position || collator.compare(left.title, right.title);
}

/** Paragraphs of a plain-text body: blank lines separate them; nothing is read as HTML (K3). */
export function articleParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
