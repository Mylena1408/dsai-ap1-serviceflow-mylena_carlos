import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { ServiceChecklistsPanel, serviceChecklistMessage } from "@/app/_components/service-checklists";
import type { ChecklistTemplateItem } from "@/modules/checklists";

// SPEC 2026-11-08-atendimento-dia-a-dia, 4.1 item 1 and 4.3 item 1 (SF-201; CA-CHK-02 through the screen).

const item = (id: string, position: number, overrides: Partial<ChecklistTemplateItem> = {}): ChecklistTemplateItem => ({
  id,
  text: `Item ${id}`,
  isRequired: true,
  position,
  isActive: true,
  conditionFieldId: null,
  conditionValue: null,
  ...overrides,
});

describe("the services' checklists screen", () => {
  it("lists each service's items in order, with the moves only where they apply", () => {
    const html = renderToStaticMarkup(
      createElement(ServiceChecklistsPanel, {
        area: "admin",
        open: "s1",
        services: [
          {
            service: { id: "s1", name: "Instalar software", sectorName: "TI" },
            items: [item("a", 1), item("b", 2, { isRequired: false }), item("c", 3, { isActive: false })],
          },
          { service: { id: "s2", name: "Férias", sectorName: "RH" }, items: [] },
        ],
      }),
    );
    expect(html).toContain("Instalar software (TI) — 2 itens ativos");
    expect(html).toContain("Checklist de Instalar software");
    expect(html).toContain(">Opcional<");
    expect(html).toContain(">Inativo<");
    // The first is not moved up nor the last down; the inactive one is not moved at all.
    expect(html).not.toContain("Subir Item a");
    expect(html).toContain("Descer Item a");
    expect(html).toContain("Subir Item b");
    expect(html).not.toContain("Descer Item b");
    expect(html).not.toContain("Subir Item c");
    expect(html).toContain("Reativar Item c");
    expect(html).toContain("Sem checklist: as solicitações deste serviço seguem como hoje.");
    expect(html).toContain("Novo item do checklist de Férias");
    expect(html).toContain('value="admin"');
    // Only the service just changed starts open.
    expect(html.match(/<details class="service-checklist" open="">/g)).toHaveLength(1);
  });

  it("hides the new item's form at the limit of 20 active items", () => {
    const html = renderToStaticMarkup(
      createElement(ServiceChecklistsPanel, {
        area: "approvals",
        services: [{ service: { id: "s1", name: "Cheio", sectorName: "TI" }, items: Array.from({ length: 20 }, (_, index) => item(`i${index}`, index + 1)) }],
      }),
    );
    expect(html).toContain("Limite de 20 itens ativos atingido.");
    expect(html).not.toContain("Novo item do checklist");
  });

  it("explains each result", () => {
    expect(serviceChecklistMessage("checklist-created")).toEqual({ text: "Item acrescentado ao checklist.", error: false });
    expect(serviceChecklistMessage("checklist-limit")?.error).toBe(true);
    expect(serviceChecklistMessage("other")).toBeNull();
    expect(serviceChecklistMessage(undefined)).toBeNull();
  });
});
