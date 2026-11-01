import { ValidationError } from "@/server/errors";
import type { RequestStatus } from "./request";

// Search, filters, order and pages of the request lists (SPEC 2026-10-31-busca-filtros-
// paginacao, section 5). Raw values come from the URL; everything is validated here.

export const SEARCH_PAGE_SIZE = 20;
export const MIN_SEARCH_TERM = 2;
export const MAX_SEARCH_TERM = 100;
export const SEARCH_TIME_ZONE = "America/Sao_Paulo";

const STATUSES: readonly RequestStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const ASSIGNEE_FILTERS = ["all", "mine", "unassigned"] as const;
const ORDERS = ["newest", "oldest"] as const;

export type SearchAudience = "requester" | "attendant";
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];
export type SearchOrder = (typeof ORDERS)[number];

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

function timeZoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - instant;
}

/** Midnight of a calendar day (YYYY-MM-DD) in the given time zone, as an instant. */
export function startOfDayInTimeZone(day: string, timeZone: string = SEARCH_TIME_ZONE): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);

  if (!match) {
    invalid("invalid_format");
  }

  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = Date.UTC(year, month - 1, date);
  const check = new Date(utcMidnight);

  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    invalid("invalid_value");
  }

  // Two passes absorb a daylight-saving change between the guess and the result.
  let instant = utcMidnight - timeZoneOffsetMs(utcMidnight, timeZone);
  instant = utcMidnight - timeZoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
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
  if (!ORDERS.includes(orderRaw as SearchOrder)) {
    invalid("invalid_value");
  }

  const from = single(raw.from) || null;
  const to = single(raw.to) || null;
  const openedFrom = from ? startOfDayInTimeZone(from) : null;
  // Validates the last day before deriving the next one from it.
  const lastDay = to ? startOfDayInTimeZone(to) : null;
  const openedBefore = to ? startOfDayInTimeZone(nextDay(to)) : null;

  if (openedFrom && lastDay && openedFrom.getTime() > lastDay.getTime()) {
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

/** Escapes LIKE wildcards so `%` and `_` in the term are plain text (section 5.2). */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
