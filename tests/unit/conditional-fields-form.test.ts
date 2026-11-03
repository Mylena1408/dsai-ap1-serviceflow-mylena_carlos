import { beforeEach, describe, expect, it, vi } from "vitest";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.1 and 5.2.6 (SF-135).

const requests = vi.hoisted(() => ({ createRequest: vi.fn() }));
vi.mock("@/modules/requests", () => requests);
vi.mock("@/modules/comments", () => ({ addComment: vi.fn() }));
vi.mock("@/modules/service-fields", async () => {
  const { FieldAnswersError } = await import("@/modules/service-fields/domain/field-value");
  return { FieldAnswersError };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createRequestAction } from "@/app/(requester)/requests/actions";
import { conditionShown, type OpeningField } from "@/app/(requester)/catalog/[serviceId]/request-form";

const field = (overrides: Partial<OpeningField>): OpeningField => ({
  id: "f",
  label: "Campo",
  helpText: null,
  type: "SHORT_TEXT",
  isRequired: false,
  options: [],
  minValue: null,
  maxValue: null,
  ...overrides,
});

describe("opening form with conditions (5.2.6)", () => {
  const kind = field({ id: "kind", label: "Tipo", type: "SELECT", options: ["Notebook", "Desktop"] });
  const devices = field({ id: "devices", label: "Acessórios", type: "MULTI_SELECT", options: ["Mouse", "Monitor"] });
  const repaired = field({ id: "repaired", label: "Já foi consertado", type: "YES_NO" });
  const charger = field({ id: "charger", conditionFieldId: "kind", conditionValue: "Notebook" });
  const monitor = field({ id: "monitor", conditionFieldId: "devices", conditionValue: "Monitor" });
  const when = field({ id: "when", conditionFieldId: "repaired", conditionValue: "true" });
  const fields = [kind, devices, repaired, charger, monitor, when];

  it("shows a conditional field with the same rule as the server", () => {
    expect(conditionShown(kind, fields, {})).toBe(true);
    expect(conditionShown(charger, fields, {})).toBe(false);
    expect(conditionShown(charger, fields, { "field.kind": "Notebook" })).toBe(true);
    expect(conditionShown(charger, fields, { "field.kind": "Desktop" })).toBe(false);
    expect(conditionShown(monitor, fields, { "field.devices": ["Mouse", "Monitor"] })).toBe(true);
    expect(conditionShown(monitor, fields, { "field.devices": "Mouse" })).toBe(false);
    expect(conditionShown(when, fields, { "field.repaired": "true" })).toBe(true);
    expect(conditionShown(field({ conditionFieldId: "gone", conditionValue: "x" }), fields, {})).toBe(false);
  });
});

describe("opening action with a multiple choice (5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.createRequest.mockResolvedValue({ id: "request-id" });
  });

  it("sends a list when several boxes share the name, and a text otherwise", async () => {
    const data = new FormData();
    data.set("serviceId", "service-id");
    data.set("description", "Notebook novo");
    data.append("field.devices", "Mouse");
    data.append("field.devices", "Monitor");
    data.set("field.kind", "Notebook");

    await expect(createRequestAction(data)).rejects.toThrow("REDIRECT:");
    expect(requests.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ fieldValues: { devices: ["Mouse", "Monitor"], kind: "Notebook" } }),
    );
  });
});
