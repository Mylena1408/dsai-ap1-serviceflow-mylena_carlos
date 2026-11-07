import { z } from "zod";
import { ConflictError, ValidationError } from "@/server/errors";
import { entityIdSchema } from "@/shared/validation";

// Links between requests (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1, decision H2): "relacionada
// a", symmetric, and "duplicada de", from the duplicate to the original. One link per pair; a
// duplicate points to one original, which is not a duplicate itself. Linking never changes a status.

export const LINK_KINDS = ["RELATED", "DUPLICATE_OF"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const MAX_LINKS_PER_REQUEST = 10;

/** The short code the screens show: the first 8 hexadecimal digits of the id, with or without "#". */
export const requestCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#/, "").toUpperCase())
  .refine((value) => /^[0-9A-F]{8}$/.test(value));

export const linkInputSchema = z
  .object({ requestId: entityIdSchema, code: requestCodeSchema, kind: z.enum(LINK_KINDS) })
  .strict();

export const unlinkInputSchema = z.object({ requestId: entityIdSchema, linkId: entityIdSchema }).strict();

/** The ids a short code may stand for, as an inclusive range the primary key index can use. */
export function codeRange(code: string): { from: string; to: string } {
  const prefix = code.toLowerCase();
  return { from: `${prefix}-0000-0000-0000-000000000000`, to: `${prefix}-ffff-ffff-ffff-ffffffffffff` };
}

export interface LinkRecord {
  id: string;
  fromRequestId: string;
  toRequestId: string;
  kind: LinkKind;
}

/** The other request of a link, seen from `requestId`. */
export function otherRequestId(link: Pick<LinkRecord, "fromRequestId" | "toRequestId">, requestId: string): string {
  return link.fromRequestId === requestId ? link.toRequestId : link.fromRequestId;
}

export type LinkRole = "related" | "duplicate_of" | "original_of";

/** How a link reads from `requestId`: "relacionada a", "duplicada de" or "original de". */
export function linkRole(link: Pick<LinkRecord, "fromRequestId" | "kind">, requestId: string): LinkRole {
  if (link.kind === "RELATED") return "related";
  return link.fromRequestId === requestId ? "duplicate_of" : "original_of";
}

export const LINK_ROLE_LABELS: Record<LinkRole, string> = {
  related: "Relacionada a",
  duplicate_of: "Duplicada de",
  original_of: "Original de",
};

/**
 * 3.3 item 1: not itself, one link per pair, up to 10 links on each side and, for "duplicada de",
 * no chains: the duplicate is not yet a duplicate nor an original of others, and the original is
 * not a duplicate.
 */
export function assertCanLink(
  sourceId: string,
  targetId: string,
  kind: LinkKind,
  sourceLinks: readonly LinkRecord[],
  targetLinks: readonly LinkRecord[],
): void {
  if (sourceId === targetId) {
    throw new ValidationError([{ path: ["code"], code: "invalid_value" }]);
  }
  if (sourceLinks.some((link) => otherRequestId(link, sourceId) === targetId)) {
    throw new ConflictError();
  }
  if (sourceLinks.length >= MAX_LINKS_PER_REQUEST || targetLinks.length >= MAX_LINKS_PER_REQUEST) {
    throw new ConflictError();
  }
  if (kind === "DUPLICATE_OF") {
    const isDuplicate = (id: string, links: readonly LinkRecord[]) => links.some((link) => link.kind === "DUPLICATE_OF" && link.fromRequestId === id);
    const isOriginal = (id: string, links: readonly LinkRecord[]) => links.some((link) => link.kind === "DUPLICATE_OF" && link.toRequestId === id);
    if (isDuplicate(sourceId, sourceLinks) || isOriginal(sourceId, sourceLinks) || isDuplicate(targetId, targetLinks)) {
      throw new ConflictError();
    }
  }
}

/**
 * 3.3 item 1: the requester sees a link only between two of their own requests; whoever attends
 * sees every link of the request.
 */
export function linkVisibleToRequester(viewerId: string, otherRequesterId: string): boolean {
  return viewerId === otherRequesterId;
}
