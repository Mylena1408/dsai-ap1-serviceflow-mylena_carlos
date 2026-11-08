import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestChecklist, checklistFeedback } from "@/app/_components/request-checklist";
import type { RequestChecklistItemView, RequestChecklistView } from "@/modules/checklists";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.3 item 3 and 13.1 items 3 and 4 (SF-205).

const action = async (): Promise<never> => {
  throw new Error("not called");
};
const done = new Date("2026-11-08T15:00:00Z");
const item = (id: string, position: number, overrides: Partial<RequestChecklistItemView> = {}): RequestChecklistItemView => ({
  id,
  textSnapshot: `Item ${id}`,
  isRequired: true,
  position,
  doneAt: null,
  doneById: null,
  note: null,
  doneByName: null,
  ...overrides,
});
const view = (overrides: Partial<RequestChecklistView> = {}): RequestChecklistView => {
  const items = [item("a", 1, { doneAt: done, doneById: "ana", doneByName: "Ana", note: "Versão 2.1" }), item("b", 2), item("c", 3, { isRequired: false })];
  return { items, progress: { done: 1, total: 3 }, pending: [items[1]], events: [], canMark: true, ...overrides };
};

const render = (props: Parameters<typeof RequestChecklist>[0]) => renderToStaticMarkup(createElement(RequestChecklist, props));

describe("the request's checklist block", () => {
  it("shows the progress, the pending required items, who marked and the note, and the forms of who may mark", () => {
    const html = render({ requestId: "r1", view: view(), markAction: action });
    expect(html).toContain("Checklist 1/3");
    expect(html).toContain("Obrigatórios por marcar: Item b.");
    expect(html).toContain("Concluído por Ana");
    expect(html).toContain("Observação: Versão 2.1");
    expect(html).toContain("Desmarcar Item a");
    expect(html).toContain('aria-label="Marcar Item b"');
    expect(html).toContain("(opcional)");
  });

  it("only reads without the action or the right to mark now", () => {
    for (const html of [render({ requestId: "r1", view: view() }), render({ requestId: "r1", view: view({ canMark: false }), markAction: action })]) {
      expect(html).toContain("Checklist 1/3");
      expect(html).not.toContain("<form");
    }
  });

  it("shows nothing without a checklist or without items (CA-CHK-01)", () => {
    expect(render({ requestId: "r1", view: { items: null, progress: null, pending: [], events: [], canMark: false } })).toBe("");
    expect(render({ requestId: "r1", view: { items: [], progress: null, pending: [], events: [], canMark: false } })).toBe("");
  });

  it("says when every required item is marked, and explains each result", () => {
    expect(render({ requestId: "r1", view: view({ pending: [] }) })).toContain("Todos os itens obrigatórios estão marcados.");
    expect(checklistFeedback("checklist-done")).toBe("Item do checklist marcado.");
    expect(checklistFeedback("checklist-note")).toContain("200 caracteres");
    expect(checklistFeedback("other")).toBeNull();
    expect(checklistFeedback(undefined)).toBeNull();
  });
});
