import type { RequestLinkView } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 1 (SF-219): the form to close as a duplicate shows only on a request
// linked as "duplicada de" an original that is not cancelled; anything else reads as before (CA-DUP-01). The server
// checks the same again when closing.

export type DuplicateOriginal = RequestLinkView["other"];

export function duplicateOriginal(links: readonly RequestLinkView[]): DuplicateOriginal | null {
  const link = links.find((candidate) => candidate.role === "duplicate_of");
  return link && link.other.status !== "CANCELLED" ? link.other : null;
}
