import { ConflictError, NotFoundError } from "@/server/errors";

// Rules of the satisfaction survey (SPEC 2026-11-06-pesquisa-satisfacao, 4): the owner rates a
// completed request within 30 days of the completion, once per completion. All instants come
// from the database clock.

export const SATISFACTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_SATISFACTION_COMMENT_LENGTH = 1_000;
export const SATISFACTION_RATINGS = [1, 2, 3, 4, 5] as const;

export interface SatisfactionTarget {
  requesterId: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  completedAt: Date | null;
  /** The completion the current rating refers to, if any. */
  ratedCompletionAt: Date | null;
}

export interface SatisfactionActor {
  id: string;
  role: string;
  isActive: boolean;
}

export type SatisfactionAvailability = "available" | "rated" | "expired" | "not_completed";

/** Whether the owner may rate now; never says anything to someone else (4.1). */
export function satisfactionAvailability(target: SatisfactionTarget, now: Date): SatisfactionAvailability {
  if (target.status !== "COMPLETED" || target.completedAt === null) return "not_completed";
  if (target.ratedCompletionAt !== null && target.ratedCompletionAt.getTime() === target.completedAt.getTime()) return "rated";
  if (now.getTime() - target.completedAt.getTime() > SATISFACTION_WINDOW_MS) return "expired";
  return "available";
}

/** Last instant at which the current completion can still be rated. */
export function satisfactionDeadline(completedAt: Date): Date {
  return new Date(completedAt.getTime() + SATISFACTION_WINDOW_MS);
}

/**
 * Refuses everything but the active owner of a completed, unrated, recent request. Someone else
 * gets "not found", as for any request they cannot read; the owner gets a conflict.
 */
export function assertCanRate(actor: SatisfactionActor, target: SatisfactionTarget, now: Date): void {
  if (!actor.isActive || actor.role !== "REQUESTER" || actor.id !== target.requesterId) {
    throw new NotFoundError();
  }
  if (satisfactionAvailability(target, now) !== "available") {
    throw new ConflictError();
  }
}

/** Whether a new rating replaces one of an earlier completion (4.3). */
export function replacesEarlierRating(target: SatisfactionTarget): boolean {
  return target.ratedCompletionAt !== null;
}

/** Blank comments are no comment; text is kept as written otherwise. */
export function normalizeSatisfactionComment(comment: string | null | undefined): string | null {
  const trimmed = comment?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
