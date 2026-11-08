import { z } from "zod";
import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { MAX_TAGS_PER_REQUEST, planTagChange, type TagActor, type TagColor, type TagRecord, type TaggableRequest } from "../domain/tag";

// Tags on a request (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 2 and 3; decisions I2 and I4): the
// attendants of the request's sector put tags on and take them off, each change in the history and in the
// event `request.tags_changed`. Only the team sees them: the sector's attendants and its manager read them; the
// requester never does.

export const requestTagChangeSchema = z
  .object({
    requestId: entityIdSchema,
    add: z.array(entityIdSchema).max(MAX_TAGS_PER_REQUEST).default([]),
    remove: z.array(entityIdSchema).max(MAX_TAGS_PER_REQUEST * 2).default([]),
  })
  .strict();

export interface RequestTagView {
  id: string;
  name: string;
  color: TagColor;
  isActive: boolean;
  /** A tag of a former sector, kept until removed (decision I4). */
  fromOtherSector: boolean;
}

export interface RequestTagEventView {
  id: string;
  occurredAt: Date;
  action: "ADDED" | "REMOVED";
  tagName: string;
  actorName: string;
}

export interface RequestTagsView {
  tags: RequestTagView[];
  /** The active tags of the request's sector that are not on it. */
  choices: Array<Pick<TagRecord, "id" | "name" | "color">>;
  events: RequestTagEventView[];
  /** Whether the reader may change them: an attendant of the sector, on a request not cancelled. */
  canEdit: boolean;
}

export interface RequestTagReader {
  findRequest(requestId: string): Promise<TaggableRequest | null>;
  /** The tags of these requests, by request (only the ones that have tags). */
  tagsOfRequests?(requestIds: readonly string[]): Promise<Array<{ requestId: string; tag: TagRecord }>>;
  tagsOf(requestId: string): Promise<TagRecord[]>;
  activeTags(sectorId: string): Promise<TagRecord[]>;
  events(requestId: string): Promise<RequestTagEventView[]>;
}

export interface RequestTagTransaction {
  findActor(userId: string): Promise<TagActor | null>;
  findRequest(requestId: string): Promise<TaggableRequest | null>;
  tagsByIds(tagIds: readonly string[]): Promise<TagRecord[]>;
  currentTime(): Promise<Date>;
  apply(change: { requestId: string; add: readonly string[]; remove: readonly string[]; actorId: string; occurredAt: Date }): Promise<void>;
}

export interface RequestTagStore {
  run<T>(work: (transaction: RequestTagTransaction) => Promise<T>): Promise<T>;
}

/** The team of the request's sector: its attendants and its manager. Anyone else is told it does not exist. */
function assertTeamReader(actor: TagActor, request: TaggableRequest): void {
  if (!actor.isActive || (actor.role !== "ATTENDANT" && actor.role !== "MANAGER") || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }
}

export async function getRequestTags(requestId: unknown, reader: RequestTagReader): Promise<RequestTagsView> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, requestId);
  const request = await reader.findRequest(id);
  if (!request) throw new NotFoundError();
  assertTeamReader(actor, request);

  const [tags, active, events] = await Promise.all([reader.tagsOf(id), reader.activeTags(request.sectorId), reader.events(id)]);
  const on = new Set(tags.map((tag) => tag.id));
  return {
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, isActive: tag.isActive, fromOtherSector: tag.sectorId !== request.sectorId })),
    choices: active.filter((tag) => !on.has(tag.id)).map(({ id: tagId, name, color }) => ({ id: tagId, name, color })),
    events,
    canEdit: actor.role === "ATTENDANT" && request.status !== "CANCELLED",
  };
}

/** The active tags of the attendant's sector, for the queue's filter and batch (3.3 items 4 and 5). */
export async function listQueueTags(reader: Pick<RequestTagReader, "activeTags">): Promise<Array<Pick<TagRecord, "id" | "name" | "color">>> {
  const actor = await requireCurrentActor();
  if (actor.role !== "ATTENDANT" || !actor.sectorId) return [];
  return (await reader.activeTags(actor.sectorId)).map(({ id, name, color }) => ({ id, name, color }));
}

/**
 * The tags of the queue page's requests (3.3 item 4), by request, for the attendant: only requests of the
 * attendant's sector are read, so a list never shows another sector's tags. A former sector's tag comes muted.
 */
export async function listQueuePageTags(
  requestIds: readonly string[],
  reader: Pick<RequestTagReader, "tagsOfRequests">,
  sectorOf: (requestIds: readonly string[]) => Promise<Map<string, string>>,
): Promise<Map<string, RequestTagView[]>> {
  const actor = await requireCurrentActor();
  const result = new Map<string, RequestTagView[]>();
  if (actor.role !== "ATTENDANT" || !actor.sectorId || requestIds.length === 0 || !reader.tagsOfRequests) return result;
  const sectors = await sectorOf(requestIds);
  const own = requestIds.filter((id) => sectors.get(id) === actor.sectorId);
  for (const { requestId, tag } of await reader.tagsOfRequests(own)) {
    const views = result.get(requestId) ?? [];
    views.push({ id: tag.id, name: tag.name, color: tag.color, isActive: tag.isActive, fromOtherSector: tag.sectorId !== actor.sectorId });
    result.set(requestId, views);
  }
  return result;
}

/** Puts tags on and takes them off one request; a change that changes nothing writes nothing. */
export async function changeRequestTags(input: unknown, store: RequestTagStore): Promise<{ added: number; removed: number }> {
  const authorized = await requireCurrentActor();
  const change = validateInput(requestTagChangeSchema, input);

  return store.run(async (transaction) => {
    const [actor, request] = await Promise.all([transaction.findActor(authorized.id), transaction.findRequest(change.requestId)]);
    if (!actor || !request) throw new NotFoundError();
    // Outside the sector's attendants, the request is not reachable (the same answer as reading it).
    if (!actor.isActive || actor.role !== "ATTENDANT" || actor.sectorId !== request.sectorId) throw new NotFoundError();

    const tags = new Map((await transaction.tagsByIds([...change.add, ...change.remove])).map((tag) => [tag.id, tag]));
    const plan = planTagChange(actor, request, change, tags);
    if (plan.add.length === 0 && plan.remove.length === 0) return { added: 0, removed: 0 };

    await transaction.apply({ requestId: change.requestId, ...plan, actorId: actor.id, occurredAt: await transaction.currentTime() });
    return { added: plan.add.length, removed: plan.remove.length };
  });
}
