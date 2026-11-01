import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-01-campos-personalizados, section 5.1 (SF-072): administrative actions of custom fields.

const fields = vi.hoisted(() => ({
  createServiceField: vi.fn(),
  updateServiceField: vi.fn(),
  moveServiceField: vi.fn(),
  deactivateServiceField: vi.fn(),
  reactivateServiceField: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@/modules/service-fields", () => fields);
vi.mock("@/modules/service-stages", () => ({}));
vi.mock("@/modules/services", () => ({}));
vi.mock("@/modules/document-requirements", () => ({}));
vi.mock("@/modules/sectors", () => ({}));
vi.mock("@/modules/categories", () => ({}));
vi.mock("@/modules/users", () => ({}));
vi.mock("@/modules/permissions", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import {
  createServiceFieldAction,
  deactivateServiceFieldAction,
  moveServiceFieldAction,
  reactivateServiceFieldAction,
  updateServiceFieldAction,
} from "@/app/(admin)/admin/actions";

const emptyState = { status: "error" as const, message: "" };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("custom field admin actions (SF-072)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const operation of Object.values(fields)) operation.mockResolvedValue({});
  });

  it("creates a list field with one option per line, ignoring blank lines and form-chosen state", async () => {
    await expect(
      createServiceFieldAction(
        emptyState,
        form({
          serviceId: "service-id",
          label: "Turno",
          helpText: "Quando atender",
          type: "SELECT",
          isRequired: "true",
          options: " Manhã \r\n\r\nTarde\n",
          position: "7",
          isActive: "false",
        }),
      ),
    ).resolves.toEqual({ status: "success", message: "Registro criado." });

    expect(fields.createServiceField).toHaveBeenCalledWith("service-id", {
      label: "Turno",
      helpText: "Quando atender",
      type: "SELECT",
      isRequired: true,
      options: ["Manhã", "Tarde"],
      minValue: null,
      maxValue: null,
    });
    expect(nextCache.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("reads integer limits, treating blanks as no limit and passing other text to validation", async () => {
    await createServiceFieldAction(
      emptyState,
      form({ serviceId: "service-id", label: "Qtd", type: "INTEGER", isRequired: "false", minValue: "-5", maxValue: " " }),
    );
    await createServiceFieldAction(
      emptyState,
      form({ serviceId: "service-id", label: "Qtd", type: "INTEGER", isRequired: "maybe", minValue: "1.5" }),
    );

    expect(fields.createServiceField).toHaveBeenNthCalledWith(1, "service-id", expect.objectContaining({
      isRequired: false,
      options: [],
      minValue: -5,
      maxValue: null,
    }));
    expect(fields.createServiceField).toHaveBeenNthCalledWith(2, "service-id", expect.objectContaining({
      isRequired: "maybe",
      minValue: "1.5",
    }));
  });

  it("updates by field id without letting the form choose the service", async () => {
    await expect(
      updateServiceFieldAction(
        emptyState,
        form({ id: "field-id", serviceId: "other", label: "Data", type: "DATE", isRequired: "true", helpText: "" }),
      ),
    ).resolves.toEqual({ status: "success", message: "Alterações salvas." });

    expect(fields.updateServiceField).toHaveBeenCalledWith("field-id", {
      label: "Data",
      helpText: "",
      type: "DATE",
      isRequired: true,
      options: [],
      minValue: null,
      maxValue: null,
    });
  });

  it("maps errors to the fixed messages of the administrative forms", async () => {
    fields.createServiceField.mockRejectedValueOnce(new ConflictError());
    fields.createServiceField.mockRejectedValueOnce(new ValidationError([]));
    fields.updateServiceField.mockRejectedValueOnce(new AuthorizationError());

    await expect(createServiceFieldAction(emptyState, form({ serviceId: "s", label: "A" }))).resolves.toEqual({
      status: "error",
      message: "Já existe um registro com esses dados ou uma opção selecionada não está disponível.",
    });
    await expect(createServiceFieldAction(emptyState, form({ serviceId: "s", label: "" }))).resolves.toEqual({
      status: "error",
      message: "Confira os campos: há valores ausentes ou inválidos.",
    });
    await expect(updateServiceFieldAction(emptyState, form({ id: "f", label: "A" }))).resolves.toEqual({
      status: "error",
      message: "Sua sessão não tem permissão para essa operação.",
    });
  });

  it("moves, deactivates and reactivates through redirecting forms in the services section", async () => {
    await expect(moveServiceFieldAction(form({ id: "field-id", direction: "down", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&notice=updated&entity=serviceFields",
    );
    await expect(deactivateServiceFieldAction(form({ id: "field-id", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&notice=status&entity=serviceFields",
    );
    await expect(reactivateServiceFieldAction(form({ id: "field-id", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&notice=status&entity=serviceFields",
    );

    expect(fields.moveServiceField).toHaveBeenCalledWith("field-id", "down");
    expect(fields.deactivateServiceField).toHaveBeenCalledWith("field-id");
    expect(fields.reactivateServiceField).toHaveBeenCalledWith("field-id");
  });

  it("reports a refused reactivation as a dependency error of custom fields", async () => {
    fields.reactivateServiceField.mockRejectedValueOnce(new ConflictError());

    await expect(reactivateServiceFieldAction(form({ id: "field-id", section: "services" }))).rejects.toThrow(
      "REDIRECT:/admin?section=services&error=dependency&entity=serviceFields",
    );
  });
});
