import { ValidationError } from "@/server/errors";
import { SAO_PAULO_TIME_ZONE, addDays, calendarDayError, startOfZonedDay } from "@/shared/time";
import type { RequestStatus } from "./request";

// Search, filters, order and pages of the request lists (SPEC 2026-10-31-busca-filtros-
// paginacao, section 5). Raw values come from the URL; everything is validated here.

export const SEARCH_PAGE_SIZE = 20;
export const MIN_SEARCH_TERM = 2;
export const MAX_SEARCH_TERM = 100;
export const SEARCH_TIME_ZONE = SAO_PAULO_TIME_ZONE;

const STATUSES: readonly RequestStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const ASSIGNEE_FILTERS = ["all", "mine", "unassigned"] as const;
const ORDERS = ["newest", "oldest", "due"] as const;
/** Orders of each list; "due" (nearest due date first) exists only in the queue (SPEC 2026-11-01, 5.6). */
const AUDIENCE_ORDERS: Record<SearchAudience, readonly SearchOrder[]> = {
  requester: ["newest", "oldest"],
  attendant: ORDERS,
};
// "paused" added by SPEC 2026-11-03-pausa-sla-calendario, 5.7.
const SLA_FILTERS = ["on_time", "due_soon", "overdue", "none", "paused"] as const;

export type SearchAudience = "requester" | "attendant";
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];
export type SearchOrder = (typeof ORDERS)[number];
/** Situations of the queue filter (SPEC 2026-11-01-sla-prioridades, sections 5.4 and 5.6). */
export type SlaFilter = (typeof SLA_FILTERS)[number];

export interface SearchCriteria {
  term: string | null;
  /** Empty means every status. */
  statuses: RequestStatus[];
  /** Always "all" for requesters (section 5.3). */
  assignee: AssigneeFilter;
  /** Inclusive lower bound: start of the first day in São Paulo. */
  openedFrom: Date | null;
  /** Exclusive upper bound: start of the day after the last day in São Paulo. */
  openedBefore: Date | null;
  order: SearchOrder;
  page: number;
  /** Queue only, and present only when chosen (SPEC 2026-11-01, section 5.6). */
  sla?: SlaFilter;
  /**
   * Queue only (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.4): the current stage's name,
   * or "none" for requests without a stage. Present only when chosen.
   */
  stage?: StageFilter;
  /**
   * Queue only (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 4): requests with any of these tags. Present
   * only when chosen.
   */
  tagIds?: string[];
}

/** 3.3 item 4: up to 5 tags in the filter, as many as a request may have. */
export const MAX_TAG_FILTERS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The value of the "Etapa" filter that means "Sem etapa". */
export const NO_STAGE_FILTER = "__none__";
export const MAX_STAGE_FILTER_LENGTH = 60;

export type StageFilter = { kind: "none" } | { kind: "name"; name: string };

/** 5.3.4: empty is no filter; "__none__" is "Sem etapa"; any other value is a stage name of 1 to 60 characters. */
export function parseStageFilter(raw: string | undefined): StageFilter | null {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  if (value === NO_STAGE_FILTER) return { kind: "none" };
  if ([...value].length > MAX_STAGE_FILTER_LENGTH) invalid("too_big");
  return { kind: "name", name: value };
}

/** Query parameters as Next.js delivers them: absent, one value or repeated. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function invalid(code: string): never {
  throw new ValidationError([{ path: ["search"], code }]);
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Midnight of a calendar day (YYYY-MM-DD) in the given time zone, as an instant. */
export function startOfDayInTimeZone(day: string, timeZone: string = SEARCH_TIME_ZONE): Date {
  const error = calendarDayError(day);

  if (error) {
    invalid(error);
  }

  return startOfZonedDay(day, timeZone);
}

/** Section 5.2: 2 to 100 characters after trimming; empty means no search. */
function parseTerm(raw: string | undefined): string | null {
  const term = raw?.trim() ?? "";

  if (term === "") return null;
  if ([...term].length < MIN_SEARCH_TERM) invalid("too_small");
  if ([...term].length > MAX_SEARCH_TERM) invalid("too_big");
  return term;
}

/** Section 5.5: anything that is not a positive integer is page 1. */
function parsePage(raw: string | undefined): number {
  return raw !== undefined && /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

/**
 * Turns URL parameters into validated criteria (sections 5.2 to 5.6). Unknown parameters
 * are ignored; invalid values of known parameters are rejected with a fixed message.
 */
export function parseSearchCriteria(raw: RawSearchParams, audience: SearchAudience): SearchCriteria {
  const statuses = [...new Set(many(raw.status).filter((value) => value !== ""))];

  if (statuses.some((status) => !STATUSES.includes(status as RequestStatus))) {
    invalid("invalid_value");
  }

  const assigneeRaw = single(raw.assignee) || "all";
  if (!ASSIGNEE_FILTERS.includes(assigneeRaw as AssigneeFilter)) {
    invalid("invalid_value");
  }

  const orderRaw = single(raw.order) || (audience === "requester" ? "newest" : "oldest");
  if (!AUDIENCE_ORDERS[audience].includes(orderRaw as SearchOrder)) {
    invalid("invalid_value");
  }

  // The requester list has no SLA filter (section 5.6), so the parameter is ignored there.
  const slaRaw = audience === "attendant" ? single(raw.sla) || null : null;
  if (slaRaw !== null && !SLA_FILTERS.includes(slaRaw as SlaFilter)) {
    invalid("invalid_value");
  }

  const from = single(raw.from) || null;
  const to = single(raw.to) || null;
  const openedFrom = from ? startOfDayInTimeZone(from) : null;
  // Validates the last day before deriving the next one from it.
  const lastDay = to ? startOfDayInTimeZone(to) : null;
  const openedBefore = to ? startOfDayInTimeZone(addDays(to, 1)) : null;

  if (openedFrom && lastDay && openedFrom.getTime() > lastDay.getTime()) {
    invalid("invalid_value");
  }

  // The requester list has no stage filter either (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.4).
  const stage = audience === "attendant" ? parseStageFilter(single(raw.stage)) : null;
  // Nor a tag filter: only the team sees tags (SPEC 2026-11-08-atendimento-dia-a-dia, decision I2).
  const tagIds = audience === "attendant" ? [...new Set(many(raw.tag).map((value) => value.trim().toLowerCase()).filter((value) => value !== ""))] : [];
  if (tagIds.length > MAX_TAG_FILTERS || tagIds.some((id) => !UUID.test(id))) {
    invalid("invalid_value");
  }

  return {
    term: parseTerm(single(raw.q)),
    statuses: statuses as RequestStatus[],
    assignee: audience === "attendant" ? (assigneeRaw as AssigneeFilter) : "all",
    openedFrom,
    openedBefore,
    order: orderRaw as SearchOrder,
    page: parsePage(single(raw.page)),
    ...(slaRaw !== null ? { sla: slaRaw as SlaFilter } : {}),
    ...(stage !== null ? { stage } : {}),
    ...(tagIds.length > 0 ? { tagIds } : {}),
  };
}

export interface PageWindow {
  page: number;
  pageCount: number;
  skip: number;
  take: number;
}

/** Section 5.5: a page beyond the last shows the last one; an empty list has one page. */
export function pageWindow(total: number, requestedPage: number, pageSize: number = SEARCH_PAGE_SIZE): PageWindow {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount, skip: (page - 1) * pageSize, take: pageSize };
}

/** Answer types stored as digits only (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.2). */
export const DIGIT_ANSWER_TYPES = ["PHONE", "CPF", "CNPJ", "CEP"] as const;

/**
 * The digits of a term written only with digits and the usual punctuation ("123.456", "(91)
 * 98765"), so it also finds answers stored as digits (3.3.5). Null for any other term, and for
 * fewer than 2 digits, the minimum of the search.
 */
export function digitsSearchTerm(term: string): string | null {
  const digits = term.replace(/[\s.\-/()]/g, "");
  return /^\d{2,}$/.test(digits) ? digits : null;
}

/** Escapes LIKE wildcards so `%` and `_` in the term are plain text (section 5.2). */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
