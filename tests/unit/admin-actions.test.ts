import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";

const domain = vi.hoisted(() => ({
  createCategory: vi.fn(),
  createSector: vi.fn(),
  createService: vi.fn(),
  createUser: vi.fn(),
  setCategoryActive: vi.fn(),
  setSectorActive: vi.fn(),
  setServiceActive: vi.fn(),
  setUserActive: vi.fn(),
  updateCategory: vi.fn(),
  updateSector: vi.fn(),
  updateService: vi.fn(),
  updateUser: vi.fn(),
  createDocumentRequirement: vi.fn(),
  updateDocumentRequirement: vi.fn(),
  moveDocumentRequirement: vi.fn(),
  deactivateDocumentRequirement: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
const nextCache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/modules/sectors", () => ({
  createSector: domain.createSector,
  setSectorActive: domain.setSectorActive,
  updateSector: domain.updateSector,
}));
vi.mock("@/modules/categories", () => ({
  createCategory: domain.createCategory,
  setCategoryActive: domain.setCategoryActive,
  updateCategory: domain.updateCategory,
}));
vi.mock("@/modules/users", () => ({
  createUser: domain.createUser,
  setUserActive: domain.setUserActive,
  updateUser: domain.updateUser,
}));
vi.mock("@/modules/services", () => ({
  createService: domain.createService,
  setServiceActive: domain.setServiceActive,
  updateService: domain.updateService,
}));
vi.mock("@/modules/document-requirements", () => ({
  createDocumentRequirement: domain.createDocumentRequirement,
  updateDocumentRequirement: domain.updateDocumentRequirement,
  moveDocumentRequirement: domain.moveDocumentRequirement,
  deactivateDocumentRequirement: domain.deactivateDocumentRequirement,
}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => nextCache);

import {
  type AdminUpdateState,
  createCategoryAction,
  createDocumentRequirementAction,
  deactivateDocumentRequirementAction,
  moveDocumentRequirementAction,
  updateDocumentRequirementAction,
  createSectorAction,
  createServiceAction,
  createUserAction,
  toggleCategoryAction,
  toggleSectorAction,
  toggleServiceAction,
  toggleUserAction,
  updateCategoryAction,
  updateSectorAction,
  updateServiceAction,
  updateUserAction,
} from "@/app/(admin)/admin/actions";

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function expectRedirect(action: Promise<never>, path: string): Promise<void> {
  await expect(action).rejects.toThrow(`REDIRECT:${path}`);
}

async function expectUpdate(
  action: Promise<AdminUpdateState>,
  status: AdminUpdateState["status"],
  message: string,
): Promise<void> {
  await expect(action).resolves.toEqual({ status, message });
}

async function expectCreate(
  action: Promise<AdminUpdateState>,
  status: AdminUpdateState["status"],
  message: string,
): Promise<void> {
  await expect(action).resolves.toEqual({ status, message });
}

describe("administrative Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const operation of Object.values(domain)) operation.mockResolvedValue({});
  });

  it("routes create forms through the protected domain operations", async () => {
    await expectCreate(
      createSectorAction({ status: "error", message: "" }, formData({ name: "Operations" })),
      "success",
      "Registro criado.",
    );
    await expectCreate(
      createCategoryAction({ status: "error", message: "" }, formData({ name: "General" })),
      "success",
      "Registro criado.",
    );
    await expectCreate(
      createUserAction(
        { status: "error", message: "" },
        formData({
          name: "Requester",
          email: "person@example.test",
          password: "secret",
          role: "REQUESTER",
          sectorId: "",
        }),
      ),
      "success",
      "Registro criado.",
    );
    await expectCreate(
      createServiceAction(
        { status: "error", message: "" },
        formData({
          name: "Support",
          description: "Service description",
          categoryId: "category-id",
          sectorId: "sector-id",
        }),
      ),
      "success",
      "Registro criado.",
    );

    expect(domain.createSector).toHaveBeenCalledWith({ name: "Operations" });
    expect(domain.createCategory).toHaveBeenCalledWith({ name: "General" });
    expect(domain.createUser).toHaveBeenCalledWith({
      name: "Requester",
      email: "person@example.test",
      password: "secret",
      role: "REQUESTER",
      sectorId: null,
    });
    expect(domain.createService).toHaveBeenCalledWith({
      name: "Support",
      description: "Service description",
      categoryId: "category-id",
      sectorId: "sector-id",
    });
    expect(nextCache.revalidatePath).toHaveBeenCalledTimes(4);
  });

  it("routes edit and activation forms to the corresponding domain operations", async () => {
    await expectUpdate(
      updateSectorAction(
        { status: "error", message: "" },
        formData({ id: "sector", name: "New name" }),
      ),
      "success",
      "Alterações salvas.",
    );
    await expectRedirect(
      toggleSectorAction(formData({ id: "sector", isActive: "false", section: "sectors" })),
      "/admin?section=sectors&notice=status&entity=sectors",
    );
    await expectUpdate(
      updateCategoryAction(
        { status: "error", message: "" },
        formData({ id: "category", name: "New category" }),
      ),
      "success",
      "Alterações salvas.",
    );
    await expectRedirect(
      toggleCategoryAction(formData({ id: "category", isActive: "true", section: "categories" })),
      "/admin?section=categories&notice=status&entity=categories",
    );
    await expectUpdate(
      updateUserAction(
        { status: "error", message: "" },
        formData({
          id: "user",
          name: "Attendant",
          email: "attendant@example.test",
          password: "",
          role: "ATTENDANT",
          sectorId: "sector",
        }),
      ),
      "success",
      "Alterações salvas.",
    );
    await expectRedirect(
      toggleUserAction(formData({ id: "user", isActive: "false", section: "users" })),
      "/admin?section=users&notice=status&entity=users",
    );
    await expectUpdate(
      updateServiceAction(
        { status: "error", message: "" },
        formData({
          id: "service",
          name: "New service",
          description: "New details",
          categoryId: "category",
          sectorId: "sector",
        }),
      ),
      "success",
      "Alterações salvas.",
    );
    await expectRedirect(
      toggleServiceAction(formData({ id: "service", isActive: "false", section: "services" })),
      "/admin?section=services&notice=status&entity=services",
    );

    expect(domain.updateSector).toHaveBeenCalledWith("sector", { name: "New name" });
    expect(domain.setSectorActive).toHaveBeenCalledWith("sector", false);
    expect(domain.updateCategory).toHaveBeenCalledWith("category", { name: "New category" });
    expect(domain.setCategoryActive).toHaveBeenCalledWith("category", true);
    expect(domain.updateUser).toHaveBeenCalledWith("user", {
      name: "Attendant",
      email: "attendant@example.test",
      password: undefined,
      role: "ATTENDANT",
      sectorId: "sector",
    });
    expect(domain.setUserActive).toHaveBeenCalledWith("user", false);
    expect(domain.updateService).toHaveBeenCalledWith("service", {
      name: "New service",
      description: "New details",
      categoryId: "category",
      sectorId: "sector",
    });
    expect(domain.setServiceActive).toHaveBeenCalledWith("service", false);
    expect(nextCache.revalidatePath).toHaveBeenCalledTimes(8);
  });

  it("returns a safe error state when a domain update is rejected", async () => {
    domain.updateUser.mockRejectedValueOnce(new ConflictError());

    await expectUpdate(
      updateUserAction(
        { status: "error", message: "" },
        formData({
          id: "user",
          name: "Attendant",
          email: "attendant@example.test",
          password: "",
          role: "ATTENDANT",
          sectorId: "sector",
        }),
      ),
      "error",
      "A alteração conflita com as dependências ou solicitações existentes.",
    );
    expect(nextCache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns safe, understandable form states for validation and dependency errors", async () => {
    domain.createSector.mockRejectedValueOnce(new ValidationError([]));
    await expectCreate(
      createSectorAction({ status: "error", message: "" }, formData({ name: "" })),
      "error",
      "Confira os campos: há valores ausentes ou inválidos.",
    );

    domain.setCategoryActive.mockRejectedValueOnce(new ConflictError());
    await expectRedirect(
      toggleCategoryAction(formData({
        id: "category",
        isActive: "false",
        section: "categories",
      })),
      "/admin?section=categories&error=dependency&entity=categories",
    );

    domain.createService.mockRejectedValueOnce(
      new Error("sensitive database details"),
    );
    await expectCreate(
      createServiceAction(
        { status: "error", message: "" },
        formData({
          name: "Service",
          description: "Details",
          categoryId: "category",
          sectorId: "sector",
        }),
      ),
      "error",
      "Não foi possível criar o registro. Tente novamente.",
    );
  });
});

describe("document requirement Server Actions", () => {
  function requirementForm(values: Record<string, string>, formats: string[]): FormData {
    const data = formData(values);
    for (const format of formats) data.append("acceptedFormats", format);
    return data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    for (const operation of Object.values(domain)) operation.mockResolvedValue({});
  });

  it("creates a requirement with only the editable fields and the service from the form", async () => {
    await expectCreate(
      createDocumentRequirementAction(
        { status: "error", message: "" },
        requirementForm(
          {
            serviceId: "service-id",
            name: "Requerimento de férias",
            isRequired: "true",
            position: "99",
            isActive: "false",
          },
          ["PDF", "DOCX"],
        ),
      ),
      "success",
      "Registro criado.",
    );

    expect(domain.createDocumentRequirement).toHaveBeenCalledWith("service-id", {
      name: "Requerimento de férias",
      isRequired: true,
      acceptedFormats: ["PDF", "DOCX"],
    });
  });

  it("updates without letting the form choose service, position or state", async () => {
    await expectUpdate(
      updateDocumentRequirementAction(
        { status: "error", message: "" },
        requirementForm(
          {
            id: "requirement-id",
            serviceId: "other-service",
            name: "Documento de autorização",
            isRequired: "false",
            position: "0",
            isActive: "true",
          },
          ["TXT"],
        ),
      ),
      "success",
      "Alterações salvas.",
    );

    expect(domain.updateDocumentRequirement).toHaveBeenCalledWith("requirement-id", {
      name: "Documento de autorização",
      isRequired: false,
      acceptedFormats: ["TXT"],
    });
  });

  it("passes unexpected flag values to server validation instead of coercing them", async () => {
    await createDocumentRequirementAction(
      { status: "error", message: "" },
      requirementForm({ serviceId: "service-id", name: "Doc", isRequired: "yes" }, []),
    );

    expect(domain.createDocumentRequirement).toHaveBeenCalledWith("service-id", {
      name: "Doc",
      isRequired: "yes",
      acceptedFormats: [],
    });
  });

  it("moves and deactivates through redirecting forms in the services section", async () => {
    await expectRedirect(
      moveDocumentRequirementAction(
        formData({ id: "requirement-id", direction: "up", section: "services" }),
      ),
      "/admin?section=services&notice=updated&entity=documentRequirements",
    );
    await expectRedirect(
      deactivateDocumentRequirementAction(
        formData({ id: "requirement-id", section: "services", isActive: "true" }),
      ),
      "/admin?section=services&notice=status&entity=documentRequirements",
    );

    expect(domain.moveDocumentRequirement).toHaveBeenCalledWith("requirement-id", "up");
    expect(domain.deactivateDocumentRequirement).toHaveBeenCalledWith("requirement-id");
    expect(nextCache.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("maps domain errors to fixed messages", async () => {
    domain.createDocumentRequirement.mockRejectedValueOnce(new ConflictError());
    await expectCreate(
      createDocumentRequirementAction(
        { status: "error", message: "" },
        requirementForm({ serviceId: "service-id", name: "Duplicado", isRequired: "true" }, ["PDF"]),
      ),
      "error",
      "Já existe um registro com esses dados ou uma opção selecionada não está disponível.",
    );

    domain.updateDocumentRequirement.mockRejectedValueOnce(new ValidationError([]));
    await expectUpdate(
      updateDocumentRequirementAction(
        { status: "error", message: "" },
        requirementForm({ id: "requirement-id", name: "", isRequired: "true" }, []),
      ),
      "error",
      "Confira os campos: há valores ausentes ou inválidos.",
    );

    domain.moveDocumentRequirement.mockRejectedValueOnce(new ConflictError());
    await expectRedirect(
      moveDocumentRequirementAction(
        formData({ id: "requirement-id", direction: "down", section: "services" }),
      ),
      "/admin?section=services&error=dependency&entity=documentRequirements",
    );

    domain.deactivateDocumentRequirement.mockRejectedValueOnce(
      new Error("sensitive database details"),
    );
    await expect(
      deactivateDocumentRequirementAction(formData({ id: "requirement-id", section: "services" })),
    ).rejects.toThrow("sensitive database details");
    expect(nextNavigation.redirect).not.toHaveBeenCalledWith(
      expect.stringContaining("sensitive"),
    );
  });
});
