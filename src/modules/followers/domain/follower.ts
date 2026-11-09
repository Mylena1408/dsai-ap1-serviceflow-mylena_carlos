import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// Followers of a request (SPEC 2026-11-08-atendimento-dia-a-dia, part D and 13.3; decisions I12 to I14, I22 and J6
// to J7): the requester adds colleagues (other requesters) who read the request as the requester does, without
// acting on it; attendants of the request's sector follow it themselves to receive its notices.

export const MAX_COLLEAGUE_FOLLOWERS = 10;

export type FollowerRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface FollowerPerson {
  id: string;
  role: FollowerRole;
  isActive: boolean;
  sectorId: string | null;
}

export interface FollowedRequest {
  requesterId: string;
  sectorId: string;
}

export interface CurrentFollower {
  userId: string;
  role: FollowerRole;
}

/** A colleague is another requester; an attendant follows only for themselves (6.3 item 1; decision I22). */
export type FollowKind = "colleague" | "attendant";

/**
 * 6.3 item 1: the requester adds an active colleague with the requester profile (never themselves), up to 10
 * colleagues; an active attendant of the request's sector follows it themselves. Anyone else does not reach the
 * request. Following twice is a conflict.
 */
export function planAddFollower(
  actor: FollowerPerson,
  request: FollowedRequest,
  target: FollowerPerson | null,
  current: readonly CurrentFollower[],
): FollowKind {
  if (!actor.isActive) throw new NotFoundError();
  if (actor.role === "ATTENDANT") {
    if (actor.sectorId !== request.sectorId) throw new NotFoundError();
    if (!target || target.id !== actor.id) throw new ValidationError([{ path: ["userId"], code: "invalid_value" }]);
    if (current.some(({ userId }) => userId === actor.id)) throw new ConflictError();
    return "attendant";
  }
  if (actor.role !== "REQUESTER" || actor.id !== request.requesterId) throw new NotFoundError();
  if (!target || !target.isActive || target.role !== "REQUESTER" || target.id === request.requesterId) {
    throw new ValidationError([{ path: ["userId"], code: "invalid_value" }]);
  }
  if (current.some(({ userId }) => userId === target.id)) throw new ConflictError();
  if (current.filter(({ role }) => role === "REQUESTER").length >= MAX_COLLEAGUE_FOLLOWERS) {
    throw new ValidationError([{ path: ["userId"], code: "too_big" }]);
  }
  return "colleague";
}

/**
 * 6.3 item 1: the requester removes any colleague; anyone who follows stops following themselves. Removing someone
 * who does not follow is a conflict; anyone else does not reach the request.
 */
export function assertCanRemoveFollower(actor: FollowerPerson, request: FollowedRequest, targetId: string, current: readonly CurrentFollower[]): void {
  const following = current.find(({ userId }) => userId === targetId);
  const self = actor.id === targetId;
  const requesterRemovesColleague = actor.role === "REQUESTER" && actor.id === request.requesterId && following?.role === "REQUESTER";
  if (!self && !requesterRemovesColleague) throw new NotFoundError();
  if (!following) throw new ConflictError();
}

/** 6.3 item 2 (decision I13): a colleague who follows reads as the requester, without acting. */
export function readsAsFollower(person: Pick<FollowerPerson, "id" | "role" | "isActive">, followerIds: readonly string[]): boolean {
  return person.isActive && person.role === "REQUESTER" && followerIds.includes(person.id);
}

/** 6.3 item 4: the history's line. */
export function followerEventTitle(event: { action: "ADDED" | "REMOVED"; userName: string }): string {
  return event.action === "ADDED" ? `${event.userName} passou a acompanhar` : `${event.userName} deixou de acompanhar`;
}

/** 13.3 item 2 (decision J7): without a saved choice, commenting makes the attendant follow. */
export function autoFollowsOnComment(saved: { autoFollowOnComment: boolean } | null): boolean {
  return saved?.autoFollowOnComment ?? true;
}
