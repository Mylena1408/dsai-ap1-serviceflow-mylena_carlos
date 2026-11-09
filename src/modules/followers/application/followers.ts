import { z } from "zod";
import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { emailSchema, entityIdSchema } from "@/shared/validation";
import {
  MAX_COLLEAGUE_FOLLOWERS,
  assertCanRemoveFollower,
  planAddFollower,
  readsAsFollower,
  type CurrentFollower,
  type FollowedRequest,
  type FollowerPerson,
  type FollowerRole,
} from "../domain/follower";

// Following a request (SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 items 1, 2 and 4; decisions I13, I14 and I22). The
// requester adds a colleague by their exact e-mail (no list of people is shown to requesters); an attendant of the
// sector follows and stops following themselves; every change goes to the history.

export interface FollowerView {
  userId: string;
  name: string;
  /** A colleague the requester added, or an attendant who follows themselves. */
  kind: "colleague" | "attendant";
}

export interface FollowerEventView {
  id: string;
  occurredAt: Date;
  action: "ADDED" | "REMOVED";
  userName: string;
  actorName: string;
}

export interface RequestFollowersView {
  /** Who reads the view, for their own "stop following". */
  viewerId: string;
  followers: FollowerView[];
  events: FollowerEventView[];
  /** What the reader may do now. */
  canAddColleague: boolean;
  canFollowSelf: boolean;
  canStopFollowing: boolean;
  /** The colleagues the reader may remove (the requester's). */
  removableIds: string[];
}

/** 6.3 item 2: what a colleague who follows reads besides the request: public comments, answers and documents. */
export interface FollowerReading {
  comments: Array<{ id: string; body: string; authorName: string; createdAt: Date }>;
  answers: Array<{ label: string; type: string; value: string }>;
  documents: Array<{ name: string; format: string; sizeBytes: number; removed: boolean }>;
}

export interface FollowerTransaction {
  findActor(userId: string): Promise<FollowerPerson | null>;
  findRequest(requestId: string): Promise<FollowedRequest | null>;
  findByEmail(email: string): Promise<FollowerPerson | null>;
  findPerson(userId: string): Promise<FollowerPerson | null>;
  listFollowers(requestId: string): Promise<CurrentFollower[]>;
  currentTime(): Promise<Date>;
  add(change: { requestId: string; userId: string; addedById: string; at: Date }): Promise<void>;
  remove(change: { requestId: string; userId: string; actorId: string; at: Date }): Promise<void>;
}

export interface FollowerStore {
  run<T>(work: (transaction: FollowerTransaction) => Promise<T>): Promise<T>;
}

export interface FollowerReader {
  findRequest(requestId: string): Promise<FollowedRequest | null>;
  followers(requestId: string): Promise<Array<FollowerView & { role: FollowerRole }>>;
  events(requestId: string): Promise<FollowerEventView[]>;
  reading(requestId: string): Promise<FollowerReading>;
}

const addSchema = z
  .object({
    requestId: entityIdSchema,
    /** A colleague's exact e-mail; absent when an attendant follows themselves. */
    email: emailSchema.optional(),
  })
  .strict();

const removeSchema = z.object({ requestId: entityIdSchema, userId: entityIdSchema }).strict();

/** 6.3 item 1: adds a colleague (the requester) or the attendant themselves. */
export async function addFollower(input: unknown, store: FollowerStore): Promise<{ added: "colleague" | "attendant" }> {
  const authorized = await requireCurrentActor();
  const { requestId, email } = validateInput(addSchema, input);

  return store.run(async (transaction) => {
    const [actor, request] = await Promise.all([transaction.findActor(authorized.id), transaction.findRequest(requestId)]);
    if (!actor || !request) throw new NotFoundError();
    const target = actor.role === "ATTENDANT" ? actor : email ? await transaction.findByEmail(email) : null;
    if (actor.role !== "ATTENDANT" && !email) throw new ValidationError([{ path: ["email"], code: "invalid_value" }]);
    // An unknown e-mail reads as an invalid choice, without saying whether the person exists.
    const kind = planAddFollower(actor, request, target, await transaction.listFollowers(requestId));
    await transaction.add({ requestId, userId: target!.id, addedById: actor.id, at: await transaction.currentTime() });
    return { added: kind };
  });
}

/** 6.3 item 1: the requester removes a colleague; anyone who follows stops following themselves. */
export async function removeFollower(input: unknown, store: FollowerStore): Promise<void> {
  const authorized = await requireCurrentActor();
  const { requestId, userId } = validateInput(removeSchema, input);

  await store.run(async (transaction) => {
    const [actor, request] = await Promise.all([transaction.findActor(authorized.id), transaction.findRequest(requestId)]);
    if (!actor || !request || !actor.isActive) throw new NotFoundError();
    assertCanRemoveFollower(actor, request, userId, await transaction.listFollowers(requestId));
    await transaction.remove({ requestId, userId, actorId: actor.id, at: await transaction.currentTime() });
  });
}

/**
 * Who follows, for the requester, a colleague who follows, and the team of the sector (attendants and its manager).
 * Anyone else is told the request does not exist.
 */
export async function getRequestFollowers(requestId: unknown, reader: FollowerReader): Promise<RequestFollowersView> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, requestId);
  const request = await reader.findRequest(id);
  if (!request) throw new NotFoundError();
  const all = await reader.followers(id);
  const ids = all.map(({ userId }) => userId);
  const requester = actor.role === "REQUESTER" && actor.id === request.requesterId;
  const colleague = readsAsFollower({ id: actor.id, role: actor.role, isActive: true }, ids);
  const team = (actor.role === "ATTENDANT" || actor.role === "MANAGER") && actor.sectorId === request.sectorId;
  if (!requester && !colleague && !team) throw new NotFoundError();

  const following = ids.includes(actor.id);
  return {
    viewerId: actor.id,
    followers: all.map(({ userId, name, kind }) => ({ userId, name, kind })),
    events: await reader.events(id),
    canAddColleague: requester && all.filter(({ kind }) => kind === "colleague").length < MAX_COLLEAGUE_FOLLOWERS,
    canFollowSelf: actor.role === "ATTENDANT" && team && !following,
    canStopFollowing: following,
    removableIds: requester ? all.filter(({ kind }) => kind === "colleague").map(({ userId }) => userId) : [],
  };
}

/** 6.3 item 2 (decision I13): the public part a colleague who follows reads; anyone else is told it does not exist. */
export async function getFollowerReading(requestId: unknown, reader: FollowerReader): Promise<FollowerReading> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, requestId);
  const followers = await reader.followers(id);
  if (!readsAsFollower({ id: actor.id, role: actor.role, isActive: true }, followers.map(({ userId }) => userId))) {
    throw new NotFoundError();
  }
  return reader.reading(id);
}

/**
 * 13.3 item 1 (decision J6): the requests an attendant follows that are now in another sector. The attendant no longer
 * reads them, so only what says where they are: the short code, the service, the status and the current sector.
 */
export interface FollowedElsewhere {
  requestId: string;
  serviceName: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  sectorName: string;
}

export async function listFollowedElsewhere(reader: { followedElsewhere(userId: string, sectorId: string): Promise<FollowedElsewhere[]> }): Promise<FollowedElsewhere[]> {
  const actor = await requireCurrentActor();
  if (actor.role !== "ATTENDANT" || !actor.sectorId) return [];
  return reader.followedElsewhere(actor.id, actor.sectorId);
}
