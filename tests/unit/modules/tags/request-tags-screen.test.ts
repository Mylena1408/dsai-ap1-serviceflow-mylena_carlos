import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import type { RequestTagsView } from "@/modules/tags";
import { RequestTags, tagEventTitle } from "@/app/_components/request-tags";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 items 2 and 3 (SF-196; CA-ETQ-03 through the screen).

const action = vi.fn(async () => undefined as never);
const view = (overrides: Partial<RequestTagsView> = {}): RequestTagsView => ({
  tags: [
    { id: "t1", name: "Rede", color: "blue", isActive: true, fromOtherSector: false },
    { id: "t2", name: "Folha", color: "green", isActive: true, fromOtherSector: true },
  ],
  choices: [{ id: "t3", name: "Urgente", color: "red" }],
  events: [],
  canEdit: true,
  ...overrides,
});

describe("the request's tags (3.3 item 2)", () => {
  it("the attendant sees the tags with a button to take each off and the form to put another on", () => {
    const html = renderToStaticMarkup(createElement(RequestTags, { requestId: "r", view: view(), edit: { addAction: action, removeAction: action } }));
    expect(html).toContain("Só a equipe vê as etiquetas.");
    expect(html).toContain('aria-label="Retirar a etiqueta Rede"');
    expect(html).toContain("(de outro setor)");
    // A former sector's tag is gray.
    expect(html).toContain("background-color:#E5E7EB");
    expect(html).toContain('<option value="t3">Urgente</option>');
  });

  it("the manager only reads; without tags, a reader sees nothing", () => {
    const html = renderToStaticMarkup(createElement(RequestTags, { requestId: "r", view: view({ canEdit: false }) }));
    expect(html).not.toContain("Retirar");
    expect(html).not.toContain("Aplicar");
    expect(renderToStaticMarkup(createElement(RequestTags, { requestId: "r", view: view({ tags: [], canEdit: false }) }))).toBe("");
  });

  it("says when the request is full or the sector has no other tag", () => {
    const full = view({ tags: Array.from({ length: 5 }, (_, index) => ({ id: `t${index}`, name: `E${index}`, color: "gray" as const, isActive: true, fromOtherSector: false })) });
    expect(renderToStaticMarkup(createElement(RequestTags, { requestId: "r", view: full, edit: { addAction: action, removeAction: action } }))).toContain("já tem 5 etiquetas");
    expect(renderToStaticMarkup(createElement(RequestTags, { requestId: "r", view: view({ choices: [] }), edit: { addAction: action, removeAction: action } }))).toContain(
      "não tem outras etiquetas ativas",
    );
  });

  it("names each change in the history (3.3 item 3)", () => {
    expect(tagEventTitle({ action: "ADDED", tagName: "Rede" })).toBe('Etiqueta "Rede" aplicada');
    expect(tagEventTitle({ action: "REMOVED", tagName: "Rede" })).toBe('Etiqueta "Rede" retirada');
  });
});
