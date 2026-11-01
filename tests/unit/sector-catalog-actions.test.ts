import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/server/errors";
import { assertCatalogSector } from "@/server/authorization/policy";

// SPEC 2026-11-01-permissoes-configuraveis, section 5.3.1 (SF-089).

const stages = vi.hoisted(() => ({ moveServiceStage: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/service-stages", () => stages);
vi.mock("@/modules/service-fields", () => ({}));
vi.mock("@/modules/services", () => ({}));
vi.mock("@/modules/document-requirements", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import { moveServiceStageAction } from "@/app/(admin)/admin/_sections/services/actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("catalog editor scope (SF-089)", () => {
  const actor = { id: "a", role: "ATTENDANT" as const, sectorId: "sector-1", isActive: true };

  it("allows every sector to the administrator and only the own sector to a holder", () => {
    expect(() => assertCatalogSector({ actor: { ...actor, role: "ADMIN" }, sectorId: null }, "sector-9")).not.toThrow();
    expect(() => assertCatalogSector({ actor, sectorId: "sector-1" }, "sector-1")).not.toThrow();
    expect(() => assertCatalogSector({ actor, sectorId: "sector-1" }, "sector-9")).toThrow(NotFoundError);
  });
});

describe("sector page redirects (SF-089)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stages.moveServiceStage.mockResolvedValue(undefined);
  });

  it("returns the redirecting forms of the sector page to it", async () => {
    await expect(
      moveServiceStageAction(form({ id: "stage-1", direction: "up", section: "sector-services" })),
    ).rejects.toThrow("REDIRECT:/sector-services?notice=updated&entity=serviceStages");
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/sector-services");
  });

  it("keeps the administration addresses unchanged", async () => {
    await expect(
      moveServiceStageAction(form({ id: "stage-1", direction: "up", section: "services" })),
    ).rejects.toThrow("REDIRECT:/admin?section=services&notice=updated&entity=serviceStages");
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/admin");
  });
});
