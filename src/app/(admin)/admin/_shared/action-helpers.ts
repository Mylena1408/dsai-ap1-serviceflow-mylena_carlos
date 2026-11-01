// Helpers shared by the administrative Server Actions (SF-042). Not a "use server"
// module: only the files under _sections/*/actions.ts expose actions.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApplicationError } from "@/server/errors";
import { activeStateInputSchema } from "@/shared/validation";
import { validateInput } from "@/server/validation";

export type Entity = "sectors" | "categories" | "users" | "services" | "documentRequirements" | "serviceFields" | "serviceStages";
export type AdminSection = "overview" | "users" | "sectors" | "categories" | "services";

export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Only the editable requirement fields are read; service, position and state never
// come from the form. Unexpected values are passed through for server validation.
export function documentRequirementFields(formData: FormData) {
  const isRequired = field(formData, "isRequired");

  return {
    name: field(formData, "name"),
    isRequired: isRequired === "true" ? true : isRequired === "false" ? false : isRequired,
    acceptedFormats: formData
      .getAll("acceptedFormats")
      .filter((value): value is string => typeof value === "string"),
  };
}

// Custom field form (SPEC 2026-11-01-campos-personalizados, 5.1 and 5.2). Options come one per
// line; blank limits mean "no limit". Fields the form does not show (options outside lists,
// limits outside integers) arrive empty. Unexpected values are passed through for validation.
export function serviceFieldFields(formData: FormData) {
  const isRequired = field(formData, "isRequired");
  const limit = (name: string) => {
    const value = field(formData, name).trim();
    return value === "" ? null : /^-?\d+$/.test(value) ? Number(value) : value;
  };

  return {
    label: field(formData, "label"),
    helpText: field(formData, "helpText"),
    type: field(formData, "type"),
    isRequired: isRequired === "true" ? true : isRequired === "false" ? false : isRequired,
    options: field(formData, "options")
      .split(/\r?\n/)
      .map((option) => option.trim())
      .filter((option) => option !== ""),
    minValue: limit("minValue"),
    maxValue: limit("maxValue"),
  };
}

export function activeState(formData: FormData): boolean {
  return validateInput(activeStateInputSchema, field(formData, "isActive"));
}

export function selectedSection(formData: FormData): AdminSection {
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

export function createFailure(error: unknown): AdminUpdateState {
  if (error instanceof ApplicationError) {
    return { status: "error", message: createErrorMessage(error) };
  }
  return { status: "error", message: "Não foi possível criar o registro. Tente novamente." };
}

export async function updateFailure(error: unknown): Promise<AdminUpdateState> {
  if (error instanceof ApplicationError) {
    return { status: "error", message: updateErrorMessage(error) };
  }
  return { status: "error", message: "Não foi possível salvar as alterações. Tente novamente." };
}

export function finishCreate(): AdminUpdateState {
  revalidatePath("/admin");
  return { status: "success", message: "Registro criado." };
}

export async function finishUpdate(): Promise<AdminUpdateState> {
  revalidatePath("/admin");
  return { status: "success", message: "Alterações salvas." };
}

export function reportFailure(entity: Entity, section: AdminSection, error: unknown): never {
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

export async function finish(
  entity: Entity,
  message: string,
  section: AdminSection,
): Promise<never> {
  revalidatePath("/admin");
  redirect(`/admin?section=${section}&notice=${message}&entity=${entity}`);
}
