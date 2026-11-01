// URL of a list page with the current search and another page (SPEC 2026-10-31-busca-
// filtros-paginacao, sections 5.5 and 5.6). Only the known parameters are kept.

const KNOWN_PARAMETERS = ["q", "status", "assignee", "sla", "from", "to", "order"] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

export function searchPageHref(basePath: string, params: SearchParams, page: number): string {
  const query = new URLSearchParams();

  for (const name of KNOWN_PARAMETERS) {
    const value = params[name];
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      if (item !== "") query.append(name, item);
    }
  }

  if (page > 1) {
    query.set("page", String(page));
  }

  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** True when the URL carries any search criterion (not counting the page or the order). */
export function hasSearchCriteria(params: SearchParams): boolean {
  return ["q", "status", "assignee", "sla", "from", "to"].some((name) => {
    const value = params[name];
    return Array.isArray(value) ? value.some((item) => item !== "" && item !== "all") : Boolean(value) && value !== "all";
  });
}
