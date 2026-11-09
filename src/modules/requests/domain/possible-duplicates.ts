import type { RequestStatus } from "./request";

// Possible duplicates (SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1, decision J9): requests of the same requester
// and the same service, opened up to 7 days before or after this one and not yet completed or cancelled. Text
// similarity is out (costly and imprecise). Only a suggestion: linking keeps its own rules.

export const POSSIBLE_DUPLICATE_DAYS = 7;
export const MAX_POSSIBLE_DUPLICATES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES: readonly RequestStatus[] = ["OPEN", "IN_PROGRESS"];

export interface DuplicateCandidate {
  id: string;
  requesterId: string;
  serviceId: string | null;
  status: RequestStatus;
  createdAt: Date;
}

/** Whether `candidate` may be a duplicate of `base` (or the other way round), by rule 1. */
export function isPossibleDuplicate(base: DuplicateCandidate, candidate: DuplicateCandidate): boolean {
  return (
    candidate.id !== base.id &&
    candidate.requesterId === base.requesterId &&
    base.serviceId !== null &&
    candidate.serviceId === base.serviceId &&
    OPEN_STATUSES.includes(candidate.status) &&
    Math.abs(candidate.createdAt.getTime() - base.createdAt.getTime()) <= POSSIBLE_DUPLICATE_DAYS * DAY_MS
  );
}

/**
 * The suggestions for `base`: rule 1, without the requests already linked to it, the closest in time first (then the
 * oldest), at most 5.
 */
export function possibleDuplicates<T extends DuplicateCandidate>(base: DuplicateCandidate, candidates: readonly T[], linkedIds: ReadonlySet<string>): T[] {
  const distance = (candidate: T) => Math.abs(candidate.createdAt.getTime() - base.createdAt.getTime());
  return candidates
    .filter((candidate) => isPossibleDuplicate(base, candidate) && !linkedIds.has(candidate.id))
    .sort((a, b) => distance(a) - distance(b) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_POSSIBLE_DUPLICATES);
}

/** The window the database reads, so the rule above is applied to a small list. */
export function possibleDuplicateWindow(createdAt: Date): { from: Date; to: Date } {
  return {
    from: new Date(createdAt.getTime() - POSSIBLE_DUPLICATE_DAYS * DAY_MS),
    to: new Date(createdAt.getTime() + POSSIBLE_DUPLICATE_DAYS * DAY_MS),
  };
}
