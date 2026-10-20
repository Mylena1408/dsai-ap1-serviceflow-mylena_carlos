"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApplicationError } from "@/server/errors";
import { activeStateInputSchema } from "@/shared/validation";
import { validateInput } from "@/server/validation";
import {
  createSector,
  setSectorActive,
  updateSector,
} from "@/modules/sectors";
import {
  createCategory,
  setCategoryActive,
  updateCategory,
} from "@/modules/categories";
import {
  createUser,
  setUserActive,
  updateUser,
} from "@/modules/users";
import {
  createService,
  setServiceActive,
  updateService,
} from "@/modules/services";
import {
  createDocumentRequirement,
  deactivateDocumentRequirement,
  moveDocumentRequirement,
  updateDocumentRequirement,
} from "@/modules/document-requirements";

type Entity = "sectors" | "categories" | "users" | "services" | "documentRequirements";
type AdminSection = "overview" | "users" | "sectors" | "categories" | "services";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Only the editable requirement fields are read; service, position and state never
// come from the form. Unexpected values are passed through for server validation.
function documentRequirementFields(formData: FormData) {
  const isRequired = field(formData, "isRequired");

  return {
    name: field(formData, "name"),
    isRequired: isRequired === "true" ? true : isRequired === "false" ? false : isRequired,
    acceptedFormats: formData
      .getAll("acceptedFormats")
      .filter((value): value is string => typeof value === "string"),
  };
}

function activeState(formData: FormData): boolean {
  return validateInput(activeStateInputSchema, field(formData, "isActive"));
}

function selectedSection(formData: FormData): AdminSection {
  const section = field(formData, "section");
  return section === "users" ||
    section === "sectors" ||
    section === "categories" ||
    section === "services"
    ? section
    : "overview";
}

export interface AdminUpdateState {
  status: "success" | "error";
  message: string;
}

function updateErrorMessage(error: ApplicationError): string {
  switch (error.code) {
    case "VALIDATION_ERROR":
      return "Confira os campos: há valores ausentes ou inválidos.";
    case "CONFLICT":
      return "A alteração conflita com as dependências ou solicitações existentes.";
    case "NOT_FOUND":
      return "O registro não existe mais. Atualize a página e tente novamente.";
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return "Sua sessão não tem permissão para essa operação.";
    default:
      return "Não foi possível salvar as alterações. Tente novamente.";
  }
}

function createErrorMessage(error: ApplicationError): string {
  switch (error.code) {
    case "VALIDATION_ERROR":
      return "Confira os campos: há valores ausentes ou inválidos.";
    case "CONFLICT":
      return "Já existe um registro com esses dados ou uma opção selecionada não está disponível.";
    case "NOT_FOUND":
      return "Uma das opções selecionadas não existe mais. Atualize a página e tente novamente.";
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return "Sua sessão não tem permissão para essa operação.";
    default:
      return "Não foi possível criar o registro. Tente novamente.";
  }
}

function createFailure(error: unknown): AdminUpdateState {
  if (error instanceof ApplicationError) {
    return { status: "error", message: createErrorMessage(error) };
  }
  return { status: "error", message: "Não foi possível criar o registro. Tente novamente." };
}

async function updateFailure(error: unknown): Promise<AdminUpdateState> {
  if (error instanceof ApplicationError) {
    return { status: "error", message: updateErrorMessage(error) };
  }
  return { status: "error", message: "Não foi possível salvar as alterações. Tente novamente." };
}

function finishCreate(): AdminUpdateState {
  revalidatePath("/admin");
  return { status: "success", message: "Registro criado." };
}

async function finishUpdate(): Promise<AdminUpdateState> {
  revalidatePath("/admin");
  return { status: "success", message: "Alterações salvas." };
}

function reportFailure(entity: Entity, section: AdminSection, error: unknown): never {
  if (error instanceof ApplicationError) {
    const code =
      error.code === "VALIDATION_ERROR"
        ? "validation"
        : error.code === "CONFLICT"
          ? "dependency"
          : error.code === "NOT_FOUND"
            ? "missing"
            : error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN"
              ? "access"
              : "unexpected";
    redirect(`/admin?section=${section}&error=${code}&entity=${entity}`);
  }

  throw error;
}

async function finish(
  entity: Entity,
  message: string,
  section: AdminSection,
): Promise<never> {
  revalidatePath("/admin");
  redirect(`/admin?section=${section}&notice=${message}&entity=${entity}`);
}

export async function createSectorAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createSector({ name: field(formData, "name") });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateSectorAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateSector(field(formData, "id"), {
      name: field(formData, "name"),
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleSectorAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setSectorActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("sectors", section, error);
  }
  return finish("sectors", "status", section);
}

export async function createCategoryAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createCategory({ name: field(formData, "name") });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateCategoryAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateCategory(field(formData, "id"), {
      name: field(formData, "name"),
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleCategoryAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setCategoryActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("categories", section, error);
  }
  return finish("categories", "status", section);
}

export async function createUserAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createUser({
      name: field(formData, "name"),
      email: field(formData, "email"),
      password: field(formData, "password"),
      role: field(formData, "role"),
      sectorId: field(formData, "sectorId") || null,
    });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateUserAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateUser(field(formData, "id"), {
      name: field(formData, "name"),
      email: field(formData, "email"),
      password: field(formData, "password") || undefined,
      role: field(formData, "role"),
      sectorId: field(formData, "sectorId") || null,
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleUserAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setUserActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("users", section, error);
  }
  return finish("users", "status", section);
}

export async function createServiceAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createService({
      name: field(formData, "name"),
      description: field(formData, "description"),
      categoryId: field(formData, "categoryId"),
      sectorId: field(formData, "sectorId"),
    });
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateServiceAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateService(field(formData, "id"), {
      name: field(formData, "name"),
      description: field(formData, "description"),
      categoryId: field(formData, "categoryId"),
      sectorId: field(formData, "sectorId"),
    });
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function toggleServiceAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await setServiceActive(
      field(formData, "id"),
      activeState(formData),
    );
  } catch (error) {
    reportFailure("services", section, error);
  }
  return finish("services", "status", section);
}

export async function createDocumentRequirementAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await createDocumentRequirement(
      field(formData, "serviceId"),
      documentRequirementFields(formData),
    );
  } catch (error) {
    return createFailure(error);
  }
  return finishCreate();
}

export async function updateDocumentRequirementAction(
  _previousState: AdminUpdateState,
  formData: FormData,
): Promise<AdminUpdateState> {
  try {
    await updateDocumentRequirement(
      field(formData, "id"),
      documentRequirementFields(formData),
    );
  } catch (error) {
    return updateFailure(error);
  }
  return finishUpdate();
}

export async function moveDocumentRequirementAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await moveDocumentRequirement(
      field(formData, "id"),
      field(formData, "direction"),
    );
  } catch (error) {
    reportFailure("documentRequirements", section, error);
  }
  return finish("documentRequirements", "updated", section);
}

export async function deactivateDocumentRequirementAction(formData: FormData): Promise<never> {
  const section = selectedSection(formData);
  try {
    await deactivateDocumentRequirement(field(formData, "id"));
  } catch (error) {
    reportFailure("documentRequirements", section, error);
  }
  return finish("documentRequirements", "status", section);
}
