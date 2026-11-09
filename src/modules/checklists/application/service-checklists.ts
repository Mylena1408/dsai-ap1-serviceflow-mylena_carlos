import { z } from "zod";
import { activeStateAction, type AuditScope } from "@/modules/audit";
import { assertConditionTarget, type ConditionController } from "@/modules/service-fields";
import { requireCurrentActor } from "@/server/authorization";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { planPositionMove } from "@/shared/ordering";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import {
  assertChecklistRoom,
  canManageServiceChecklist,
  checklistConditionSchema,
  checklistItemTextSchema,
  planModelCopy,
  type ChecklistActor,
  type ChecklistTemplateItem,
} from "../domain/checklist";

// The services' checklist models (SPEC 2026-11-08-atendimento-dia-a-dia, 4.1 item 1 and 4.3 item 1): the
// administrator for every service and a manager for the services of their sector add items, change their text
// and whether they are required, move them up and down, deactivate and reactivate them; every change goes to
// the audit trail. The checklists already copied to requests never change (decision I7).

/** A field that may be an item's condition, with the values it offers (13.1 item 1). */
export interface ChecklistConditionField {
  id: string;
  label: string;
  /** The options of a list, or "true"/"false" for yes or no. */
  values: string[];
  isYesNo: boolean;
}

export interface ServiceChecklist {
  service: { id: string; name: string; sectorName: string };
  /** Active first, by position; then the inactive ones. */
  items: ChecklistTemplateItem[];
  /** The service's fields that may be a condition, as the stages' conditions (decision J1). */
  conditionFields: ChecklistConditionField[];
  /** The labels of every field of the service by id, to show a condition whose field changed later. */
  fieldLabels: Record<string, string>;
}

export interface ServiceChecklistReader {
  /** The active services in scope (every one when null), by sector and name, with their items. */
  list(sectorId: string | null): Promise<ServiceChecklist[]>;
}

export interface ServiceChecklistTransaction extends AuditScope {
  findService(serviceId: string): Promise<{ id: string; sectorId: string; isActive: boolean } | null>;
  findItem(itemId: string): Promise<(ChecklistTemplateItem & { serviceId: string }) | null>;
  listItems(serviceId: string): Promise<ChecklistTemplateItem[]>;
  create(item: { serviceId: string; text: string; isRequired: boolean; position: number }): Promise<ChecklistTemplateItem>;
  update(
    itemId: string,
    data: Partial<Pick<ChecklistTemplateItem, "text" | "isRequired" | "position" | "isActive" | "conditionFieldId" | "conditionValue">>,
  ): Promise<ChecklistTemplateItem>;
  /** A field of the service with what the condition rule reads; null when it is of another service. */
  findConditionField(fieldId: string, serviceId: string): Promise<ConditionController | null>;
}

export interface ServiceChecklistStore {
  run<T>(work: (transaction: ServiceChecklistTransaction) => Promise<T>): Promise<T>;
}

export const checklistMoveSchema = z.enum(["up", "down"]);

/** The sector whose services' models the person manages, or null for every sector. */
function scopeOf(actor: ChecklistActor): string | null {
  if (actor.role === "ADMIN") return null;
  if (actor.role === "MANAGER" && actor.sectorId) return actor.sectorId;
  throw new AuthorizationError();
}

export async function listServiceChecklists(reader: ServiceChecklistReader): Promise<ServiceChecklist[]> {
  return reader.list(scopeOf(await requireCurrentActor()));
}

/** After the last item, active or not, so an item never takes another's place. */
const positionAfter = (items: readonly ChecklistTemplateItem[]) => items.reduce((highest, item) => Math.max(highest, item.position), 0) + 1;
const activeCount = (items: readonly ChecklistTemplateItem[]) => items.filter((item) => item.isActive).length;

export async function createChecklistItem(serviceId: unknown, input: unknown, store: ServiceChecklistStore): Promise<ChecklistTemplateItem> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, serviceId);
  const item = validateInput(checklistItemTextSchema, input);

  return store.run(async (transaction) => {
    const service = await transaction.findService(id);
    if (!service || !service.isActive) throw new NotFoundError();
    if (!canManageServiceChecklist(actor, service.sectorId)) throw new AuthorizationError();
    const items = await transaction.listItems(id);
    assertChecklistRoom(activeCount(items));
    return transaction.audited({ actor, action: "CREATED", entityType: "CHECKLIST_ITEM" }, () =>
      transaction.create({ serviceId: id, ...item, position: positionAfter(items) }),
    );
  });
}

/** An item of a service the person manages; any other is "not found". */
async function managedItem(transaction: ServiceChecklistTransaction, actor: ChecklistActor, itemId: string) {
  const item = await transaction.findItem(itemId);
  const service = item && (await transaction.findService(item.serviceId));
  if (!item || !service || !canManageServiceChecklist(actor, service.sectorId)) throw new NotFoundError();
  return item;
}

export async function updateChecklistItem(itemId: unknown, input: unknown, store: ServiceChecklistStore): Promise<ChecklistTemplateItem> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, itemId);
  const data = validateInput(checklistItemTextSchema, input);

  return store.run(async (transaction) => {
    await managedItem(transaction, actor, id);
    return transaction.audited({ actor, action: "UPDATED", entityType: "CHECKLIST_ITEM", entityId: id }, () => transaction.update(id, data));
  });
}

/**
 * "Subir" and "Descer" among the active items: one entry for the moved item; the neighbour only makes room. An
 * inactive item is not moved; the first moved up or the last moved down changes nothing.
 */
export async function moveChecklistItem(itemId: unknown, direction: unknown, store: ServiceChecklistStore): Promise<void> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, itemId);
  const move = validateInput(checklistMoveSchema, direction);

  await store.run(async (transaction) => {
    const item = await managedItem(transaction, actor, id);
    if (!item.isActive) throw new ConflictError();
    // The shared plan numbers from 0; the checklist's positions start at 1.
    const active = (await transaction.listItems(item.serviceId)).filter((other) => other.isActive);
    const updates = planPositionMove(active.map(({ id: other, position }) => ({ id: other, position: position - 1 })), id, move);
    if (updates.length === 0) return;
    await transaction.audited({ actor, action: "REORDERED", entityType: "CHECKLIST_ITEM", entityId: id }, async () => {
      // The moved item last, so its entry reads its new position.
      for (const update of [...updates.filter((other) => other.id !== id), ...updates.filter((other) => other.id === id)]) {
        await transaction.update(update.id, { position: update.position + 1 });
      }
      return { id };
    });
  });
}

/** Reactivating counts toward the 20 active items and puts the item at the end. */
export async function setChecklistItemActive(itemId: unknown, isActive: unknown, store: ServiceChecklistStore): Promise<ChecklistTemplateItem> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, itemId);
  const active = validateInput(activeStateSchema, isActive);

  return store.run(async (transaction) => {
    const item = await managedItem(transaction, actor, id);
    if (item.isActive === active) return item;
    const items = await transaction.listItems(item.serviceId);
    if (active) assertChecklistRoom(activeCount(items));
    if (active && item.conditionFieldId !== null) {
      const controller = await transaction.findConditionField(item.conditionFieldId, item.serviceId);
      if (!controller?.isActive) throw new ConflictError();
    }
    return transaction.audited({ actor, action: activeStateAction(active), entityType: "CHECKLIST_ITEM", entityId: id }, () =>
      transaction.update(id, active ? { isActive: true, position: positionAfter(items) } : { isActive: false }),
    );
  });
}

/**
 * 13.1 item 1 (decision J1): an item's condition follows the stages' rule: an active requester field of the same
 * service, with choices and without its own condition, and one of its values; or no condition at all. Requests
 * already copied keep their checklist (decision I7).
 */
export async function setChecklistItemCondition(itemId: unknown, input: unknown, store: ServiceChecklistStore): Promise<ChecklistTemplateItem> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, itemId);
  const condition = validateInput(checklistConditionSchema, input);

  return store.run(async (transaction) => {
    const item = await managedItem(transaction, actor, id);
    if (condition.conditionFieldId !== null) {
      const controller = await transaction.findConditionField(condition.conditionFieldId, item.serviceId);
      assertConditionTarget({ id: null, audience: "REQUESTER" }, controller, condition.conditionValue ?? "");
    }
    return transaction.audited({ actor, action: "UPDATED", entityType: "CHECKLIST_ITEM", entityId: id }, () => transaction.update(id, condition));
  });
}

/**
 * 13.1 item 2 (decision J2): adds another service's active items at the end of this one's model, in their order
 * and without their conditions, within the limit of 20 active items (over it, nothing is added). The source is a
 * service the person also manages; each added item has its own audit entry. Returns how many were added.
 */
export async function copyChecklistModel(serviceId: unknown, sourceServiceId: unknown, store: ServiceChecklistStore): Promise<{ added: number }> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, serviceId);
  const sourceId = validateInput(entityIdSchema, sourceServiceId);

  return store.run(async (transaction) => {
    const [service, source] = await Promise.all([transaction.findService(id), transaction.findService(sourceId)]);
    if (!service || !service.isActive) throw new NotFoundError();
    if (!canManageServiceChecklist(actor, service.sectorId)) throw new AuthorizationError();
    // Another service the person manages; anything else reads as a wrong choice.
    if (!source || source.id === id || !canManageServiceChecklist(actor, source.sectorId)) {
      throw new ValidationError([{ path: ["sourceServiceId"], code: "invalid_value" }]);
    }
    const items = await transaction.listItems(id);
    const planned = planModelCopy(await transaction.listItems(sourceId), activeCount(items), positionAfter(items));
    for (const item of planned) {
      await transaction.audited({ actor, action: "CREATED", entityType: "CHECKLIST_ITEM" }, () => transaction.create({ serviceId: id, ...item }));
    }
    return { added: planned.length };
  });
}
