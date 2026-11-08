import { z } from "zod";

// Saved views (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1; decision H16): a person saves the search
// criteria of a list under a name and goes back to them with one click. Only the person sees, renames and
// deletes their views. The criteria are kept normalized, as the list's URL carries them; when a view is
// opened, invalid criteria follow the search's current rules (the list shows its fixed message).

export const SAVED_VIEW_LISTS = ["QUEUE", "MY_REQUESTS"] as const;
export type SavedViewList = (typeof SAVED_VIEW_LISTS)[number];

export const MAX_VIEW_NAME_LENGTH = 40;
export const MAX_VIEWS_PER_LIST = 20;
export const MAX_CRITERIA_LENGTH = 1_000;

/** The search parameters of each list, in the order they are kept (SPEC 2026-10-31-busca-filtros-paginacao). */
export const LIST_PARAMETERS: Record<SavedViewList, readonly string[]> = {
  // "tag": SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 4.
  QUEUE: ["q", "status", "assignee", "sla", "stage", "tag", "from", "to", "order"],
  MY_REQUESTS: ["q", "status", "from", "to", "order"],
};

/** Where each list lives. */
export const LIST_PATHS: Record<SavedViewList, string> = { QUEUE: "/queue", MY_REQUESTS: "/requests" };

export type CriteriaSource = string | Record<string, string | string[] | undefined>;

/**
 * The list's criteria as a query string: only its parameters, in a fixed order, without blanks or the page;
 * several statuses (or tags) are sorted, so the same search always reads the same.
 */
export function normalizedCriteria(list: SavedViewList, source: CriteriaSource): string {
  const values = (name: string): string[] => {
    if (typeof source === "string") return new URLSearchParams(source.startsWith("?") ? source.slice(1) : source).getAll(name);
    const value = source[name];
    return Array.isArray(value) ? value : value === undefined ? [] : [value];
  };
  const query = new URLSearchParams();
  for (const name of LIST_PARAMETERS[list]) {
    const items = values(name).map((item) => item.trim()).filter((item) => item !== "");
    const kept = name === "status" || name === "tag" ? [...new Set(items)].sort() : items.slice(0, 1);
    for (const item of kept) query.append(name, item);
  }
  return query.toString();
}

/** The address that opens a view. */
export function viewHref(list: SavedViewList, criteria: string): string {
  return criteria ? `${LIST_PATHS[list]}?${criteria}` : LIST_PATHS[list];
}

export const viewNameSchema = z.string().trim().min(1).max(MAX_VIEW_NAME_LENGTH);
export const savedViewListSchema = z.enum(SAVED_VIEW_LISTS);

export const saveViewInputSchema = z
  .object({
    list: savedViewListSchema,
    name: viewNameSchema,
    criteria: z.string().max(4_000),
  })
  .strict();

export interface SavedViewRecord {
  id: string;
  list: SavedViewList;
  name: string;
  criteria: string;
}
