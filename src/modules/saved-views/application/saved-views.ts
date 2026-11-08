import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  MAX_CRITERIA_LENGTH,
  MAX_VIEWS_PER_LIST,
  normalizedCriteria,
  saveViewInputSchema,
  savedViewListSchema,
  viewNameSchema,
  type SavedViewList,
  type SavedViewRecord,
} from "../domain/saved-view";

// Saved views (SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1): the attendant's queue and the requester's
// "Minhas solicitações", each only for whoever uses that list; a person only ever reaches their own views.

export interface SavedViewStore {
  list(userId: string, list: SavedViewList): Promise<SavedViewRecord[]>;
  count(userId: string, list: SavedViewList): Promise<number>;
  find(viewId: string): Promise<(SavedViewRecord & { userId: string }) | null>;
  /** Null when the person already has a view with that name in the list. */
  create(view: { userId: string; list: SavedViewList; name: string; criteria: string }): Promise<SavedViewRecord | null>;
  /** False when the name is taken. */
  rename(viewId: string, name: string): Promise<boolean>;
  remove(viewId: string): Promise<void>;
}

/** Who uses each list: the queue's attendants and the requesters. */
function assertListUser(actor: AuthorizationActor, list: SavedViewList): void {
  if ((list === "QUEUE" && actor.role !== "ATTENDANT") || (list === "MY_REQUESTS" && actor.role !== "REQUESTER")) {
    throw new AuthorizationError();
  }
}

export async function listSavedViews(list: unknown, store: SavedViewStore): Promise<SavedViewRecord[]> {
  const actor = await requireCurrentActor();
  const which = validateInput(savedViewListSchema, list);
  assertListUser(actor, which);
  return store.list(actor.id, which);
}

/** 7.3 item 1: a name of 1 to 40 characters, unique for the person and list; up to 20 per list. */
export async function saveView(input: unknown, store: SavedViewStore): Promise<SavedViewRecord> {
  const actor = await requireCurrentActor();
  const parsed = validateInput(saveViewInputSchema, input);
  assertListUser(actor, parsed.list);

  const criteria = normalizedCriteria(parsed.list, parsed.criteria);
  if (criteria.length > MAX_CRITERIA_LENGTH) {
    throw new ValidationError([{ path: [], code: "too_big" }]);
  }
  if ((await store.count(actor.id, parsed.list)) >= MAX_VIEWS_PER_LIST) {
    throw new ValidationError([{ path: [], code: "too_big" }]);
  }
  const view = await store.create({ userId: actor.id, list: parsed.list, name: parsed.name, criteria });
  if (!view) throw new ConflictError();
  return view;
}

/** The person's own view, or not found (never revealing someone else's). */
async function ownView(viewId: unknown, store: SavedViewStore): Promise<SavedViewRecord> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, viewId);
  const view = await store.find(id);
  if (!view || view.userId !== actor.id) throw new NotFoundError();
  assertListUser(actor, view.list);
  return view;
}

export async function renameView(viewId: unknown, name: unknown, store: SavedViewStore): Promise<void> {
  const view = await ownView(viewId, store);
  const newName = validateInput(viewNameSchema, name);
  if (!(await store.rename(view.id, newName))) throw new ConflictError();
}

export async function deleteView(viewId: unknown, store: SavedViewStore): Promise<void> {
  const view = await ownView(viewId, store);
  await store.remove(view.id);
}
