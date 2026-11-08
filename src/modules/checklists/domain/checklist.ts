import { z } from "zod";
import { conditionMet, type ServiceFieldType } from "@/modules/service-fields";
import { ConflictError, ValidationError } from "@/server/errors";
import { entityIdSchema } from "@/shared/validation";

// Attendance checklists (SPEC 2026-11-08-atendimento-dia-a-dia, part B and 13.1; decisions I5 to I8 and J1
// to J3): each service may have a checklist model; when a request enters the attendance, the model's items
// are copied to it, the attendant marks them, and a request with required items still to mark is not
// completed. Only the team sees checklists.

export const MAX_ACTIVE_CHECKLIST_ITEMS = 20;
export const MAX_CHECKLIST_TEXT_LENGTH = 120;
export const MAX_CHECKLIST_NOTE_LENGTH = 200;
export const MAX_CHECKLIST_CONDITION_LENGTH = 80;

/** Turns an empty text into "none". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === "" ? null : value));

/**
 * 4.3 item 1 and 13.1 item 1 (decision J1): a text of 1 to 120 characters, required or optional, and an
 * optional condition with a field and a value (or neither), as the stages' conditions. Whether the field
 * may be a condition is checked against the service's fields (`assertConditionTarget`).
 */
export const checklistItemInputSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_CHECKLIST_TEXT_LENGTH),
    isRequired: z.boolean(),
    conditionFieldId: entityIdSchema.nullable(),
    conditionValue: optionalText(MAX_CHECKLIST_CONDITION_LENGTH),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.conditionFieldId === null) !== (input.conditionValue === null)) {
      context.addIssue({ code: "custom", path: ["conditionValue"], message: "A condition needs a field and a value." });
    }
  });

export type ChecklistItemInput = z.output<typeof checklistItemInputSchema>;

/** 13.1 item 4 (decision J3): an optional note of up to 200 characters when an item is marked. */
export const checklistMarkInputSchema = z
  .object({
    done: z.boolean(),
    note: optionalText(MAX_CHECKLIST_NOTE_LENGTH).default(null),
  })
  .strict();

export type ChecklistMarkInput = z.output<typeof checklistMarkInputSchema>;

/** An item of a service's model. */
export interface ChecklistTemplateItem {
  id: string;
  text: string;
  isRequired: boolean;
  position: number;
  isActive: boolean;
  conditionFieldId: string | null;
  conditionValue: string | null;
}

/** An item of a request's checklist. */
export interface RequestChecklistItemRecord {
  id: string;
  textSnapshot: string;
  isRequired: boolean;
  position: number;
  doneAt: Date | null;
  doneById: string | null;
  note: string | null;
}

// The model (4.3 item 1; 13.1 item 2).

/** 4.3 item 1: up to 20 active items per service; `adding` is how many items the change would add. */
export function assertChecklistRoom(activeItems: number, adding = 1): void {
  if (activeItems + adding > MAX_ACTIVE_CHECKLIST_ITEMS) {
    throw new ValidationError([{ path: [], code: "too_big" }]);
  }
}

function byPosition<T extends { position: number; id: string }>(left: T, right: T): number {
  return left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/**
 * 13.1 item 2 (decision J2): copying another service's model adds its active items at the end, in their
 * order, without their conditions (they point to the other service's fields), within the limit of 20 active
 * items; over the limit, nothing is added. `nextPosition` is the first free position of the target model.
 */
export function planModelCopy(
  source: readonly ChecklistTemplateItem[],
  targetActiveItems: number,
  nextPosition: number,
): Array<Pick<ChecklistTemplateItem, "text" | "isRequired" | "position">> {
  const items = source.filter((item) => item.isActive).sort(byPosition);
  if (items.length === 0) {
    throw new ValidationError([{ path: ["sourceServiceId"], code: "invalid_value" }]);
  }
  assertChecklistRoom(targetActiveItems, items.length);
  return items.map((item, index) => ({ text: item.text, isRequired: item.isRequired, position: nextPosition + index }));
}

// The copy to the request (4.3 item 2; 13.1 item 1).

export type ChecklistAnswer = { fieldId: string; type: ServiceFieldType; value: string };

/**
 * 4.3 item 2 and 13.1 item 1: the model's active items at that moment, in order, without the conditional
 * items whose condition the request's answers do not meet; the copy is numbered from 1. An empty list still
 * marks the request as copied, so reopening never copies again.
 */
export function planChecklistCopy(
  model: readonly ChecklistTemplateItem[],
  answers: readonly ChecklistAnswer[],
): Array<{ templateItemId: string; textSnapshot: string; isRequired: boolean; position: number }> {
  return model
    .filter((item) => item.isActive)
    .filter((item) => {
      if (item.conditionFieldId === null || item.conditionValue === null) return true;
      const answer = answers.find(({ fieldId }) => fieldId === item.conditionFieldId);
      return conditionMet(
        { conditionFieldId: item.conditionFieldId, conditionValue: item.conditionValue },
        answer ? { type: answer.type, value: answer.value } : undefined,
      );
    })
    .sort(byPosition)
    .map((item, index) => ({ templateItemId: item.id, textSnapshot: item.text, isRequired: item.isRequired, position: index + 1 }));
}

// Marking (4.3 item 3; 13.1 item 4).

export type ChecklistRequestStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface ChecklistMarkPlan {
  doneAt: Date | null;
  doneById: string | null;
  note: string | null;
  action: "DONE" | "UNDONE";
}

/**
 * 4.3 item 3: only while the request is in attendance (a completed request's checklist no longer changes,
 * CA-CHK-04); who may mark is the application's check. Marking records who and when, with the note;
 * unmarking clears them. Marking a marked item or unmarking an unmarked one changes nothing (null).
 */
export function planChecklistMark(
  status: ChecklistRequestStatus,
  item: Pick<RequestChecklistItemRecord, "doneAt">,
  input: ChecklistMarkInput,
  actorId: string,
  now: Date,
): ChecklistMarkPlan | null {
  if (status !== "IN_PROGRESS") {
    throw new ConflictError();
  }
  if (input.done === (item.doneAt !== null)) {
    return null;
  }
  return input.done
    ? { doneAt: now, doneById: actorId, note: input.note, action: "DONE" }
    : { doneAt: null, doneById: null, note: null, action: "UNDONE" };
}

// Completion (4.3 items 4 and 5; decision I8).

/** The required items still to mark, in order. */
export function pendingRequiredItems<T extends Pick<RequestChecklistItemRecord, "isRequired" | "doneAt" | "position">>(
  items: readonly T[],
): T[] {
  return items.filter((item) => item.isRequired && item.doneAt === null).sort((left, right) => left.position - right.position);
}

/** 4.3 item 4: with required items to mark, the completion is refused; without a checklist, it goes on. */
export function assertChecklistAllowsCompletion(items: readonly Pick<RequestChecklistItemRecord, "isRequired" | "doneAt" | "position">[]): void {
  if (pendingRequiredItems(items).length > 0) {
    throw new ConflictError();
  }
}

/** 13.1 item 3: "Checklist 3/5", marked over total; null for a request without items. */
export function checklistProgress(items: readonly Pick<RequestChecklistItemRecord, "doneAt">[]): { done: number; total: number } | null {
  if (items.length === 0) return null;
  return { done: items.filter((item) => item.doneAt !== null).length, total: items.length };
}

export function checklistProgressLabel(progress: { done: number; total: number }): string {
  return `Checklist ${progress.done}/${progress.total}`;
}
