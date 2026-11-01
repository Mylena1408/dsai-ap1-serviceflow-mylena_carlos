import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError } from "@/server/errors";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.1 (SF-077): administrative actions of the stages.

const stages = vi.hoisted(() => ({
  createServiceStage: vi.fn(),
  renameServiceStage: vi.fn(),
  moveServiceStage: vi.fn(),
  deactivateServiceStage: vi.fn(),
  reactivateServiceStage: vi.fn(),
}));
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
vi.mock("@/modules/sectors", () => ({}));
vi.mock("@/modules/categories", () => ({}));
vi.mock("@/modules/users", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import {
  createServiceStageAction,
  deactivateServiceStageAction,
  moveServiceStageAction,
  reactivateServiceStageAction,
  renameServiceStageAction,
} from "@/app/(admin)/admin/actions";

const emptyState = { status: "error" as const, message: "" };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("stage admin actions (SF-077)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const operation of Object.values(stages)) operation.mockResolvedValue({});
  });

  it("creates a stage with only the name, for the service in the form", async () => {
    await expect(
      createServiceStageAction(
        emptyState,
        form({ serviceId: "service-id", name: "Triagem", position: "4", isActive: "false" }),
      ),
    ).resolves.toEqual({ status: "success", message: "Registro criado." });

    expect(stages.createServiceStage).toHaveBeenCalledWith("service-id", { name: "Triagem" });
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("renames by stage id, without letting the form choose the service", async () => {
    await expect(
      renameServiceStageAction(emptyState, form({ id: "stage-id", serviceId: "other", name: "Execução" })),
    ).resolves.toEqual({ status: "success", message: "Alterações salvas." });

    expect(stages.renameServiceStage).toHaveBeenCalledWith("stage-id", { name: "Execução" });
  });

  it("maps errors to the fixed messages of the administrative forms", async () => {
    stages.createServiceStage.mockRejectedValueOnce(new ConflictError());
    stages.renameServiceStage.mockRejectedValueOnce(new AuthorizationError());

    await expect(createServiceStageAction(emptyState, form({ serviceId: "s", name: "A" }))).resolves.toEqual({
      status: "error",
      message: "Já existe um registro com esses dados ou uma opção selecionada não está disponível.",
    });
    await expect(renameServiceStageAction(emptyState, form({ id: "x", name: "A" }))).resolves.toEqual({
      status: "error",
      message: "Sua sessão não tem permissão para essa operação.",
    });
  });

  it("moves, deactivates and reactivates through redirecting forms in the services section", async () => {
    await expect(moveServiceStageAction(form({ id: "stage-id", direction: "up", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&notice=updated&entity=serviceStages",
    );
    await expect(deactivateServiceStageAction(form({ id: "stage-id", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&notice=status&entity=serviceStages",
    );
    await expect(reactivateServiceStageAction(form({ id: "stage-id", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&notice=status&entity=serviceStages",
    );

    expect(stages.moveServiceStage).toHaveBeenCalledWith("stage-id", "up");
    expect(stages.deactivateServiceStage).toHaveBeenCalledWith("stage-id");
    expect(stages.reactivateServiceStage).toHaveBeenCalledWith("stage-id");
  });

  it("reports a refused reactivation as a dependency error of stages", async () => {
    stages.reactivateServiceStage.mockRejectedValueOnce(new ConflictError());

    await expect(reactivateServiceStageAction(form({ id: "stage-id", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&error=dependency&entity=serviceStages",
    );
  });
});
