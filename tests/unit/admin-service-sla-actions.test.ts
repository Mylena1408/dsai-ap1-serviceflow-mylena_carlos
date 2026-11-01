import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  setServiceActive: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/services", () => services);
vi.mock("@/modules/document-requirements", () => ({}));
vi.mock("@/modules/service-fields", () => ({}));
vi.mock("@/modules/service-stages", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createServiceAction, updateServiceAction } from "@/app/(admin)/admin/_sections/services/actions";

// SPEC 2026-11-01-sla-prioridades, section 5.6 (SF-066).

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const base = { name: "Reparo", description: "Conserto", categoryId: "category", sectorId: "sector" };
const initial = { status: "error" as const, message: "" };

describe("service SLA fields in the admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends priority and SLA when the form has them, including an empty SLA", async () => {
    await createServiceAction(initial, formData({ ...base, defaultPriority: "HIGH", slaHours: "24" }));
    await updateServiceAction(initial, formData({ ...base, id: "service", defaultPriority: "LOW", slaHours: "" }));

    expect(services.createService).toHaveBeenCalledWith({ ...base, defaultPriority: "HIGH", slaHours: "24" });
    expect(services.updateService).toHaveBeenCalledWith("service", { ...base, defaultPriority: "LOW", slaHours: "" });
  });

  it("leaves them out when the form does not have the fields", async () => {
    await updateServiceAction(initial, formData({ ...base, id: "service" }));

    expect(services.updateService).toHaveBeenCalledWith("service", base);
  });
});
