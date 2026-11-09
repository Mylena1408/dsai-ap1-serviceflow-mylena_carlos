import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const checklists = vi.hoisted(() => ({ setChecklistItemCondition: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/modules/checklists", async (original) => ({ ...(await original<object>()), ...checklists }));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ServiceChecklistsPanel, conditionText } from "@/app/_components/service-checklists";
import { setChecklistItemConditionAction } from "@/app/_components/service-checklist-actions";
import type { ChecklistConditionField, ChecklistTemplateItem } from "@/modules/checklists";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 1 (SF-224; decision J1).

const FIELD = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";
const fields: ChecklistConditionField[] = [
  { id: FIELD, label: "Equipamento", values: ["Notebook", "Desktop"], isYesNo: false },
  { id: "f2", label: "Urgente", values: ["true", "false"], isYesNo: true },
];
const item = (overrides: Partial<ChecklistTemplateItem> = {}): ChecklistTemplateItem => ({
  id: ITEM,
  text: "Conferir bateria",
  isRequired: true,
  position: 1,
  isActive: true,
  conditionFieldId: null,
  conditionValue: null,
  ...overrides,
});

describe("an item's condition on the screen", () => {
  it("reads as always, or as the field and the value", () => {
    expect(conditionText(item(), fields, {})).toBe("Sempre");
    expect(conditionText(item({ conditionFieldId: FIELD, conditionValue: "Notebook" }), fields, {})).toBe('Quando "Equipamento" for "Notebook"');
    expect(conditionText(item({ conditionFieldId: "f2", conditionValue: "true" }), fields, {})).toBe('Quando "Urgente" for "Sim"');
    // A field that can no longer be a condition is still named.
    expect(conditionText(item({ conditionFieldId: "old", conditionValue: "A" }), fields, { old: "Antigo" })).toBe('Quando "Antigo" for "A"');
  });

  it("offers every value of the fields that may be a condition, with the current one chosen", () => {
    const html = renderToStaticMarkup(
      createElement(ServiceChecklistsPanel, {
        area: "admin",
        services: [
          {
            service: { id: SERVICE, name: "Instalação", sectorName: "TI" },
            items: [item({ conditionFieldId: FIELD, conditionValue: "Desktop" })],
            conditionFields: fields,
            fieldLabels: {},
          },
        ],
      }),
    );
    expect(html).toContain("Condição do item Conferir bateria");
    expect(html).toContain(`<option value="${FIELD}|Desktop" selected="">`);
    expect(html).toContain("Quando &quot;Urgente&quot; for &quot;Não&quot;");
    expect(html).toContain('<option value="">Sempre</option>');
  });

  it("sends the chosen field and value, or none", async () => {
    checklists.setChecklistItemCondition.mockResolvedValue({});
    const data = new FormData();
    data.set("area", "admin");
    data.set("serviceId", SERVICE);
    data.set("itemId", ITEM);
    data.set("condition", `${FIELD}|Notebook`);
    await expect(setChecklistItemConditionAction(data)).rejects.toThrow(`REDIRECT:/admin?section=checklists&checklist=checklist-condition-saved&open=${SERVICE}`);
    expect(checklists.setChecklistItemCondition).toHaveBeenLastCalledWith(ITEM, { conditionFieldId: FIELD, conditionValue: "Notebook" });

    data.set("condition", "");
    await expect(setChecklistItemConditionAction(data)).rejects.toThrow("REDIRECT:");
    expect(checklists.setChecklistItemCondition).toHaveBeenLastCalledWith(ITEM, { conditionFieldId: null, conditionValue: null });
  });
});

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.1 item 2 (SF-225; decision J2).
describe("copying another service's model on the screen", () => {
  it("offers the other services with active items, and not the service itself", () => {
    const html = renderToStaticMarkup(
      createElement(ServiceChecklistsPanel, {
        area: "approvals",
        services: [
          { service: { id: SERVICE, name: "Instalação", sectorName: "TI" }, items: [], conditionFields: [], fieldLabels: {} },
          { service: { id: "s2", name: "Notebook", sectorName: "TI" }, items: [item(), item({ id: "i2", position: 2 })], conditionFields: [], fieldLabels: {} },
          { service: { id: "s3", name: "Vazio", sectorName: "TI" }, items: [item({ id: "i3", isActive: false })], conditionFields: [], fieldLabels: {} },
        ],
      }),
    );
    expect(html).toContain("Copiar para Instalação");
    expect(html).toContain('<option value="s2">Notebook (TI) — 2 itens</option>');
    expect(html).not.toContain('<option value="s3">');
    // The only source has nowhere else to copy from.
    expect(html).not.toContain("Copiar para Notebook");
  });
});
