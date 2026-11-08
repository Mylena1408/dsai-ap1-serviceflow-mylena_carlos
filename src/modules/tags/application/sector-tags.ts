import { activeStateAction, type AuditScope } from "@/modules/audit";
import { requireCurrentActor } from "@/server/authorization";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import { assertTagRoom, canManageSectorTags, tagInputSchema, type TagActor, type TagRecord } from "../domain/tag";

// The sectors' tags (SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 1; decision I1): the administrator for
// every sector and a manager for their own create, change, deactivate and reactivate them; every change goes to
// the audit trail. Deactivating does not take the tag off the requests that have it.

export interface SectorTags {
  sector: { id: string; name: string };
  tags: Array<TagRecord & { inUse: number }>;
}

export interface SectorTagReader {
  /** Active sectors in scope (every one when null), by name, with their tags (active first, then by name). */
  list(sectorId: string | null): Promise<SectorTags[]>;
}

export interface SectorTagTransaction extends AuditScope {
  findSector(sectorId: string): Promise<{ id: string; isActive: boolean } | null>;
  findTag(tagId: string): Promise<TagRecord | null>;
  countActive(sectorId: string): Promise<number>;
  /** Null when the name is taken among the sector's active tags. */
  create(tag: { sectorId: string; name: string; color: TagRecord["color"] }): Promise<TagRecord | null>;
  /** Null when the name is taken. */
  update(tagId: string, data: Partial<Pick<TagRecord, "name" | "color" | "isActive">>): Promise<TagRecord | null>;
}

export interface SectorTagStore {
  run<T>(work: (transaction: SectorTagTransaction) => Promise<T>): Promise<T>;
}

/** The sector whose tags the person manages, or null for every sector. */
function scopeOf(actor: TagActor): string | null {
  if (actor.role === "ADMIN") return null;
  if (actor.role === "MANAGER" && actor.sectorId) return actor.sectorId;
  throw new AuthorizationError();
}

export async function listSectorTags(reader: SectorTagReader): Promise<SectorTags[]> {
  return reader.list(scopeOf(await requireCurrentActor()));
}

/** A name taken among the sector's active tags is a conflict. */
const taken = <T>(value: T | null): T => {
  if (value === null) throw new ConflictError();
  return value;
};

export async function createSectorTag(sectorId: unknown, input: unknown, store: SectorTagStore): Promise<TagRecord> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, sectorId);
  const tag = validateInput(tagInputSchema, input);
  if (!canManageSectorTags(actor, id)) throw new AuthorizationError();

  return store.run(async (transaction) => {
    const sector = await transaction.findSector(id);
    if (!sector || !sector.isActive) throw new NotFoundError();
    assertTagRoom(await transaction.countActive(id));
    return transaction.audited({ actor, action: "CREATED", entityType: "SECTOR_TAG" }, async () =>
      taken(await transaction.create({ sectorId: id, ...tag })),
    );
  });
}

/** A tag of a sector the person manages. */
async function managedTag(transaction: SectorTagTransaction, actor: TagActor, tagId: string): Promise<TagRecord> {
  const tag = await transaction.findTag(tagId);
  if (!tag || !canManageSectorTags(actor, tag.sectorId)) throw new NotFoundError();
  return tag;
}

export async function updateSectorTag(tagId: unknown, input: unknown, store: SectorTagStore): Promise<TagRecord> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, tagId);
  const tag = validateInput(tagInputSchema, input);

  return store.run(async (transaction) => {
    await managedTag(transaction, actor, id);
    return transaction.audited({ actor, action: "UPDATED", entityType: "SECTOR_TAG", entityId: id }, async () => taken(await transaction.update(id, tag)));
  });
}

/** Reactivating counts toward the 30 active tags and needs the name free among them. */
export async function setSectorTagActive(tagId: unknown, isActive: unknown, store: SectorTagStore): Promise<TagRecord> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, tagId);
  const active = validateInput(activeStateSchema, isActive);

  return store.run(async (transaction) => {
    const tag = await managedTag(transaction, actor, id);
    if (tag.isActive === active) return tag;
    if (active) assertTagRoom(await transaction.countActive(tag.sectorId));
    return transaction.audited({ actor, action: activeStateAction(active), entityType: "SECTOR_TAG", entityId: id }, async () =>
      taken(await transaction.update(id, { isActive: active })),
    );
  });
}
