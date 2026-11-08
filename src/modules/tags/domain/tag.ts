import { z } from "zod";
import { ConflictError, ValidationError } from "@/server/errors";

// Sectors' tags (SPEC 2026-11-08-atendimento-dia-a-dia, part A; decisions I1 to I4): each sector has its own
// tags, with a name and a color of a fixed palette; the sector's attendants put them on requests, which only
// the team sees.

export const MAX_TAG_NAME_LENGTH = 30;
export const MAX_ACTIVE_TAGS_PER_SECTOR = 30;
export const MAX_TAGS_PER_REQUEST = 5;

/**
 * Decision I3: a fixed palette, each color a light background with a dark text whose contrast passes WCAG AA
 * for normal text (4.5:1); the unit tests check every pair.
 */
export const TAG_COLORS = {
  gray: { label: "Cinza", background: "#E5E7EB", text: "#1F2937" },
  red: { label: "Vermelho", background: "#FDE2E1", text: "#991B1B" },
  orange: { label: "Laranja", background: "#FFEDD5", text: "#9A3412" },
  yellow: { label: "Amarelo", background: "#FEF3C7", text: "#854D0E" },
  green: { label: "Verde", background: "#DCFCE7", text: "#166534" },
  teal: { label: "Turquesa", background: "#CCFBF1", text: "#115E59" },
  blue: { label: "Azul", background: "#DBEAFE", text: "#1E40AF" },
  purple: { label: "Roxo", background: "#EDE9FE", text: "#5B21B6" },
} as const;

export type TagColor = keyof typeof TAG_COLORS;
export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

export const tagInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_TAG_NAME_LENGTH),
    color: z.enum(TAG_COLOR_KEYS as [TagColor, ...TagColor[]]),
  })
  .strict();

export type TagInput = z.output<typeof tagInputSchema>;

export interface TagRecord {
  id: string;
  sectorId: string;
  name: string;
  color: TagColor;
  isActive: boolean;
}

/** WCAG relative luminance of a "#RRGGBB" color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two colors, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Who manages and who applies (3.3 items 1 and 2; decision I1).

export interface TagActor {
  id: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorId: string | null;
}

/** The administrator for every sector; a manager for their own. */
export function canManageSectorTags(actor: TagActor, sectorId: string): boolean {
  return actor.isActive && (actor.role === "ADMIN" || (actor.role === "MANAGER" && actor.sectorId === sectorId));
}

/** 3.3 item 1: up to 30 active tags per sector. */
export function assertTagRoom(activeTags: number): void {
  if (activeTags >= MAX_ACTIVE_TAGS_PER_SECTOR) {
    throw new ValidationError([{ path: [], code: "too_big" }]);
  }
}

export interface TaggableRequest {
  sectorId: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /** The tags it has now. */
  tagIds: readonly string[];
}

/**
 * 3.3 item 2: an attendant of the request's current sector, on a request not cancelled; only active tags of
 * that sector are added (tags of a former sector stay until removed, decision I4); at most 5 in all.
 */
export function planTagChange(
  actor: TagActor,
  request: TaggableRequest,
  change: { add: readonly string[]; remove: readonly string[] },
  tags: ReadonlyMap<string, Pick<TagRecord, "sectorId" | "isActive">>,
): { add: string[]; remove: string[] } {
  if (!actor.isActive || actor.role !== "ATTENDANT" || actor.sectorId !== request.sectorId) {
    throw new ValidationError([{ path: ["requestId"], code: "invalid_value" }]);
  }
  if (request.status === "CANCELLED") {
    throw new ConflictError();
  }
  const current = new Set(request.tagIds);
  const add = [...new Set(change.add)].filter((id) => !current.has(id));
  const remove = [...new Set(change.remove)].filter((id) => current.has(id));
  if (add.some((id) => { const tag = tags.get(id); return !tag || !tag.isActive || tag.sectorId !== request.sectorId; })) {
    throw new ValidationError([{ path: ["tagIds"], code: "invalid_value" }]);
  }
  if (current.size + add.length - remove.length > MAX_TAGS_PER_REQUEST) {
    throw new ValidationError([{ path: ["tagIds"], code: "too_big" }]);
  }
  return { add, remove };
}
