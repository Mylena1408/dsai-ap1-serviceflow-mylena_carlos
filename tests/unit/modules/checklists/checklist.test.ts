import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_CHECKLIST_ITEMS,
  assertChecklistAllowsCompletion,
  assertChecklistRoom,
  checklistItemInputSchema,
  checklistMarkInputSchema,
  checklistProgress,
  checklistProgressLabel,
  pendingRequiredItems,
  planChecklistCopy,
  planChecklistMark,
  planModelCopy,
  type ChecklistTemplateItem,
} from "@/modules/checklists";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-08-atendimento-dia-a-dia, part B and 13.1 (SF-200).

const FIELD = "11111111-1111-4111-8111-111111111111";

function template(overrides: Partial<ChecklistTemplateItem> & { id: string; position: number }): ChecklistTemplateItem {
  return { text: `Item ${overrides.id}`, isRequired: false, isActive: true, conditionFieldId: null, conditionValue: null, ...overrides };
}

describe("the model's items (4.3 item 1; 13.1 item 1)", () => {
  it("accepts a text of 1 to 120 characters, trimmed, with or without a condition", () => {
    expect(checklistItemInputSchema.parse({ text: "  Conferir cabo  ", isRequired: true, conditionFieldId: null, conditionValue: null })).toEqual({
      text: "Conferir cabo",
      isRequired: true,
      conditionFieldId: null,
      conditionValue: null,
    });
    expect(checklistItemInputSchema.parse({ text: "x".repeat(120), isRequired: false, conditionFieldId: FIELD, conditionValue: " Sim " })).toMatchObject({
      conditionValue: "Sim",
    });
  });

  it("refuses an empty or long text, a half condition and unknown fields", () => {
    for (const input of [
      { text: "   ", isRequired: true, conditionFieldId: null, conditionValue: null },
      { text: "x".repeat(121), isRequired: true, conditionFieldId: null, conditionValue: null },
      { text: "Item", isRequired: true, conditionFieldId: FIELD, conditionValue: null },
      { text: "Item", isRequired: true, conditionFieldId: FIELD, conditionValue: "" },
      { text: "Item", isRequired: true, conditionFieldId: null, conditionValue: "Sim" },
      { text: "Item", isRequired: true, conditionFieldId: FIELD, conditionValue: "x".repeat(81) },
      { text: "Item", isRequired: true, conditionFieldId: "campo", conditionValue: "Sim" },
      { text: "Item", isRequired: true, conditionFieldId: null, conditionValue: null, serviceId: FIELD },
    ]) {
      expect(checklistItemInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("keeps at most 20 active items", () => {
    expect(() => assertChecklistRoom(MAX_ACTIVE_CHECKLIST_ITEMS - 1)).not.toThrow();
    expect(() => assertChecklistRoom(MAX_ACTIVE_CHECKLIST_ITEMS)).toThrow(ValidationError);
    expect(() => assertChecklistRoom(15, 5)).not.toThrow();
    expect(() => assertChecklistRoom(15, 6)).toThrow(ValidationError);
  });
});

describe("copying another service's model (13.1 item 2; decision J2)", () => {
  const source = [
    template({ id: "b", position: 2, text: "Testar", isRequired: true, conditionFieldId: FIELD, conditionValue: "Sim" }),
    template({ id: "a", position: 1, text: "Instalar" }),
    template({ id: "c", position: 3, text: "Antigo", isActive: false }),
  ];

  it("adds the active items at the end, in order, without conditions", () => {
    expect(planModelCopy(source, 3, 4)).toEqual([
      { text: "Instalar", isRequired: false, position: 4 },
      { text: "Testar", isRequired: true, position: 5 },
    ]);
  });

  it("adds nothing over the limit or from a model without active items", () => {
    expect(() => planModelCopy(source, 19, 20)).toThrow(ValidationError);
    expect(() => planModelCopy([source[2]], 0, 1)).toThrow(ValidationError);
  });
});

describe("the copy to the request (4.3 item 2; 13.1 item 1)", () => {
  const model = [
    template({ id: "c", position: 3, text: "Se notebook", conditionFieldId: FIELD, conditionValue: "Notebook" }),
    template({ id: "a", position: 1, text: "Sempre", isRequired: true }),
    template({ id: "d", position: 4, text: "Inativo", isActive: false }),
    template({ id: "b", position: 2, text: "Se desktop", conditionFieldId: FIELD, conditionValue: "Desktop" }),
  ];

  it("copies the active items whose condition the answers meet, numbered from 1", () => {
    expect(planChecklistCopy(model, [{ fieldId: FIELD, type: "SELECT", value: "Notebook" }])).toEqual([
      { templateItemId: "a", textSnapshot: "Sempre", isRequired: true, position: 1 },
      { templateItemId: "c", textSnapshot: "Se notebook", isRequired: false, position: 2 },
    ]);
  });

  it("leaves conditional items out without an answer; multiple choice contains the value", () => {
    expect(planChecklistCopy(model, []).map(({ templateItemId }) => templateItemId)).toEqual(["a"]);
    expect(
      planChecklistCopy(model, [{ fieldId: FIELD, type: "MULTI_SELECT", value: JSON.stringify(["Desktop", "Notebook"]) }]).map(
        ({ templateItemId }) => templateItemId,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("copies nothing from an empty model", () => {
    expect(planChecklistCopy([], [])).toEqual([]);
  });
});

describe("marking (4.3 item 3; 13.1 item 4)", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  it("records who, when and the note; unmarking clears them", () => {
    expect(planChecklistMark("IN_PROGRESS", { doneAt: null }, checklistMarkInputSchema.parse({ done: true, note: " Ok " }), "ana", now)).toEqual({
      doneAt: now,
      doneById: "ana",
      note: "Ok",
      action: "DONE",
    });
    expect(planChecklistMark("IN_PROGRESS", { doneAt: now }, checklistMarkInputSchema.parse({ done: false }), "ana", now)).toEqual({
      doneAt: null,
      doneById: null,
      note: null,
      action: "UNDONE",
    });
  });

  it("changes nothing when the item is already as asked", () => {
    expect(planChecklistMark("IN_PROGRESS", { doneAt: now }, { done: true, note: null }, "ana", now)).toBeNull();
    expect(planChecklistMark("IN_PROGRESS", { doneAt: null }, { done: false, note: null }, "ana", now)).toBeNull();
  });

  it("only while the request is in attendance", () => {
    for (const status of ["OPEN", "COMPLETED", "CANCELLED"] as const) {
      expect(() => planChecklistMark(status, { doneAt: null }, { done: true, note: null }, "ana", now)).toThrow(ConflictError);
    }
  });

  it("an empty note is none; a note over 200 characters is refused", () => {
    expect(checklistMarkInputSchema.parse({ done: true, note: "  " })).toEqual({ done: true, note: null });
    expect(checklistMarkInputSchema.safeParse({ done: true, note: "x".repeat(201) }).success).toBe(false);
  });
});

describe("completion and progress (4.3 items 4 and 5; 13.1 item 3)", () => {
  const done = new Date("2026-11-08T12:00:00Z");
  const items = [
    { position: 3, isRequired: true, doneAt: null },
    { position: 1, isRequired: true, doneAt: done },
    { position: 2, isRequired: false, doneAt: null },
    { position: 4, isRequired: true, doneAt: null },
  ];

  it("lists the required items still to mark and refuses the completion", () => {
    expect(pendingRequiredItems(items).map(({ position }) => position)).toEqual([3, 4]);
    expect(() => assertChecklistAllowsCompletion(items)).toThrow(ConflictError);
  });

  it("allows the completion with every required item marked, or without a checklist", () => {
    expect(() => assertChecklistAllowsCompletion(items.map((item) => ({ ...item, doneAt: item.isRequired ? done : null })))).not.toThrow();
    expect(() => assertChecklistAllowsCompletion([])).not.toThrow();
  });

  it("shows marked over total", () => {
    const progress = checklistProgress(items);
    expect(progress).toEqual({ done: 1, total: 4 });
    expect(checklistProgressLabel(progress!)).toBe("Checklist 1/4");
    expect(checklistProgress([])).toBeNull();
  });
});
