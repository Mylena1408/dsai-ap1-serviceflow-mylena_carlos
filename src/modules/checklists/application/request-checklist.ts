import { z } from "zod";
import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  MAX_CHECKLIST_NOTE_LENGTH,
  checklistProgress,
  pendingRequiredItems,
  planChecklistMark,
  type ChecklistActor,
  type ChecklistRequestStatus,
  type RequestChecklistItemRecord,
} from "../domain/checklist";

// A request's checklist (SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 item 4; decision I6): the
// team reads it; while the request is in attendance, its effective assignee (any attendant of the sector when
// nobody holds it) or a supervisor of the queue marks and unmarks items, each with who and when and an optional
// note, and every change goes to the history. The requester never sees it.

export const checklistMarkSchema = z
  .object({
    requestId: entityIdSchema,
    itemId: entityIdSchema,
    done: z.boolean(),
    note: z
      .string()
      .trim()
      .max(MAX_CHECKLIST_NOTE_LENGTH)
      .nullable()
      .default(null)
      .transform((value) => (value === "" ? null : value)),
  })
  .strict();

export interface ChecklistRequest {
  sectorId: string;
  status: ChecklistRequestStatus;
  /** The assignee when they are an active attendant of the request's sector; otherwise none. */
  effectiveAssigneeId: string | null;
}

export interface RequestChecklistItemView extends RequestChecklistItemRecord {
  doneByName: string | null;
}

export interface RequestChecklistEventView {
  id: string;
  occurredAt: Date;
  action: "DONE" | "UNDONE";
  itemText: string;
  note: string | null;
  actorName: string;
}

export interface RequestChecklistView {
  /** Null for a request without a checklist (copied before this version, or not started yet). */
  items: RequestChecklistItemView[] | null;
  progress: { done: number; total: number } | null;
  /** The required items still to mark, by position. */
  pending: RequestChecklistItemView[];
  events: RequestChecklistEventView[];
  /** Whether the reader marks and unmarks items now. */
  canMark: boolean;
}

export interface RequestChecklistReader {
  findRequest(requestId: string): Promise<ChecklistRequest | null>;
  /** Whether the attendant supervises the queue of the sector. */
  supervises(actor: ChecklistActor, sectorId: string): Promise<boolean>;
  items(requestId: string): Promise<RequestChecklistItemView[] | null>;
  events(requestId: string): Promise<RequestChecklistEventView[]>;
}

export interface RequestChecklistTransaction {
  findActor(userId: string): Promise<ChecklistActor | null>;
  findRequest(requestId: string): Promise<ChecklistRequest | null>;
  supervises(actor: ChecklistActor, sectorId: string): Promise<boolean>;
  findItem(itemId: string): Promise<(RequestChecklistItemRecord & { requestId: string }) | null>;
  currentTime(): Promise<Date>;
  /** Writes the marking when the item is still as read; returns false when it changed meanwhile. */
  mark(change: {
    itemId: string;
    expectedDoneAt: Date | null;
    doneAt: Date | null;
    doneById: string | null;
    note: string | null;
  }): Promise<boolean>;
  insertEvent(event: { requestId: string; itemId: string; action: "DONE" | "UNDONE"; note: string | null; actorId: string; occurredAt: Date }): Promise<void>;
}

export interface RequestChecklistStore {
  run<T>(work: (transaction: RequestChecklistTransaction) => Promise<T>): Promise<T>;
}

/** The team of the request's sector: its attendants and its manager. Anyone else is told it does not exist. */
function assertTeamReader(actor: ChecklistActor, request: ChecklistRequest): void {
  if (!actor.isActive || (actor.role !== "ATTENDANT" && actor.role !== "MANAGER") || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }
}

/** 4.3 item 3: the holder, anyone of the sector when nobody holds it, or a supervisor of the queue. */
function holdsOrSupervises(actor: ChecklistActor, request: ChecklistRequest, supervisor: boolean): boolean {
  return request.effectiveAssigneeId === null || request.effectiveAssigneeId === actor.id || supervisor;
}

/** Whether the actor supervises a request someone else holds; the permissions are read only then. */
async function supervisesOther(
  actor: ChecklistActor,
  request: ChecklistRequest,
  source: Pick<RequestChecklistReader, "supervises">,
): Promise<boolean> {
  if (request.effectiveAssigneeId === null || request.effectiveAssigneeId === actor.id) return false;
  return source.supervises(actor, request.sectorId);
}

export async function getRequestChecklist(requestId: unknown, reader: RequestChecklistReader): Promise<RequestChecklistView> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, requestId);
  const request = await reader.findRequest(id);
  if (!request) throw new NotFoundError();
  assertTeamReader(actor, request);

  const [items, events] = await Promise.all([reader.items(id), reader.events(id)]);
  const canMark =
    items !== null &&
    items.length > 0 &&
    actor.role === "ATTENDANT" &&
    request.status === "IN_PROGRESS" &&
    holdsOrSupervises(actor, request, await supervisesOther(actor, request, reader));
  return {
    items,
    progress: items ? checklistProgress(items) : null,
    pending: items ? pendingRequiredItems(items) : [],
    events,
    canMark,
  };
}

/**
 * Marks or unmarks one item. Outside the sector's attendants the request is not reachable (404); a colleague who
 * neither holds nor supervises it, a request not in attendance, or an item changed meanwhile is a conflict (409).
 */
export async function markChecklistItem(input: unknown, store: RequestChecklistStore): Promise<{ changed: boolean }> {
  const authorized = await requireCurrentActor();
  const change = validateInput(checklistMarkSchema, input);

  return store.run(async (transaction) => {
    const [actor, request, item] = await Promise.all([
      transaction.findActor(authorized.id),
      transaction.findRequest(change.requestId),
      transaction.findItem(change.itemId),
    ]);
    if (!actor || !request || !item || item.requestId !== change.requestId) throw new NotFoundError();
    if (!actor.isActive || actor.role !== "ATTENDANT" || actor.sectorId !== request.sectorId) throw new NotFoundError();
    if (!holdsOrSupervises(actor, request, await supervisesOther(actor, request, transaction))) throw new ConflictError();

    const occurredAt = await transaction.currentTime();
    const plan = planChecklistMark(request.status, item, { done: change.done, note: change.note }, actor.id, occurredAt);
    if (!plan) return { changed: false };

    const written = await transaction.mark({ itemId: item.id, expectedDoneAt: item.doneAt, doneAt: plan.doneAt, doneById: plan.doneById, note: plan.note });
    if (!written) throw new ConflictError();
    await transaction.insertEvent({ requestId: change.requestId, itemId: item.id, action: plan.action, note: plan.note, actorId: actor.id, occurredAt });
    return { changed: true };
  });
}
