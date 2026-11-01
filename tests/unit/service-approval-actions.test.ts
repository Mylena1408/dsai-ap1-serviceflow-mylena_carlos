import { beforeEach, describe, expect, it, vi } from "vitest";

// SPEC 2026-11-01-aprovacoes, section 5.2 (SF-083): "Exige aprovação do gestor" in the service form.

const services = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  setServiceActive: vi.fn(),
}));

vi.mock("@/modules/services", () => services);
vi.mock("@/modules/document-requirements", () => ({}));
vi.mock("@/modules/service-fields", () => ({}));
vi.mock("@/modules/service-stages", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createServiceAction, updateServiceAction } from "@/app/(admin)/admin/_sections/services/actions";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const base = { name: "Compra", description: "Pedido de compra", categoryId: "category", sectorId: "sector" };
const initial = { status: "error" as const, message: "" };

describe("approval option in the service actions (SF-083)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends true when the box is checked and false when it is not, if the form has it", async () => {
    await createServiceAction(initial, formData({ ...base, requiresApprovalField: "1", requiresApproval: "on" }));
    await updateServiceAction(initial, formData({ id: "service-id", ...base, requiresApprovalField: "1" }));

    expect(services.createService).toHaveBeenCalledWith(expect.objectContaining({ requiresApproval: true }));
    expect(services.updateService).toHaveBeenCalledWith("service-id", expect.objectContaining({ requiresApproval: false }));
  });

  it("leaves the option out when the form does not have it, keeping the current value", async () => {
    await updateServiceAction(initial, formData({ id: "service-id", ...base, requiresApproval: "on" }));

    expect(services.updateService.mock.calls[0][1]).not.toHaveProperty("requiresApproval");
  });
});
