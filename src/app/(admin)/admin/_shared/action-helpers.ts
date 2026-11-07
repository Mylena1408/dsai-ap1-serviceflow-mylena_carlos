// Helpers shared by the administrative Server Actions (SF-042). Not a "use server"
// module: only the files under _sections/*/actions.ts expose actions.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApplicationError, ValidationError } from "@/server/errors";
import { activeStateInputSchema } from "@/shared/validation";
import { validateInput } from "@/server/validation";

export type Entity = "sectors" | "categories" | "users" | "services" | "documentRequirements" | "serviceFields" | "serviceStages" | "permissions" | "anonymization" | "apiTokens" | "webhooks" | "webhookDeliveries" | "calendar" | "holidays"
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.
  | "roles" | "roleAssignments" | "permissionValidity" | "roleValidity"
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3.
  | "escalationRules" | "escalationRuleDays" | "escalationRuleEmpty" | "escalationRulePeople"
  // SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2.
  | "bundles";
// "sector-services" is the page of a "Gerir serviços do setor" holder (SPEC de permissões, 5.3.1).
export type AdminSection = "overview" | "users" | "sectors" | "categories" | "services" | "sector-services" | "api-tokens" | "webhooks" | "calendar" | "roles" | "bundles";

function pageFor(section: AdminSection): string {
  return section === "sector-services" ? "/sector-services?" : `/admin?section=${section}&`;
}

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
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1: places as a number, limits as typed
    // (comma or dot); the schema validates and normalizes them. Sent only when the form has them
    // (decimal fields); otherwise the schema uses "none".
    ...(formData.has("decimalPlaces")
      ? {
          decimalPlaces: limit("decimalPlaces"),
          minDecimal: field(formData, "minDecimal").trim(),
          maxDecimal: field(formData, "maxDecimal").trim(),
        }
      : {}),
    // SPEC 2026-11-03-campos-condicionais-atendimento, 5.7: sent only when the form has them, so a
    // form without them keeps the current values. "condition" is "<field id>::<value>" or empty.
    ...(formData.has("audience") ? { audience: field(formData, "audience") } : {}),
    ...(formData.has("condition") ? fieldCondition(field(formData, "condition")) : {}),
  };
}

function fieldCondition(raw: string): { conditionFieldId: string | null; conditionValue: string | null } {
  const separator = raw.indexOf("::");
  return separator < 0
    ? { conditionFieldId: raw === "" ? null : raw, conditionValue: null }
    : { conditionFieldId: raw.slice(0, separator), conditionValue: raw.slice(separator + 2) };
}

/**
 * Refusals of the custom field form (SPEC 2026-11-03-campos-condicionais-atendimento, 5.3 and 5.7):
 * a broken condition and a conflict get their own fixed messages.
 */
export function serviceFieldFailure(error: unknown, kind: "create" | "update" = "update"): AdminUpdateState | null {
  if (error instanceof ValidationError && error.issues.some(({ path }) => path[0] === "conditionFieldId" || path[0] === "conditionValue")) {
    return {
      status: "error",
      message: "Escolha uma condição válida: um campo de escolha ativo, do mesmo público e sem condição própria, e uma das suas opções.",
    };
  }
  // SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1.
  if (error instanceof ValidationError && error.issues.some(({ path }) => ["decimalPlaces", "minDecimal", "maxDecimal"].includes(String(path[0])))) {
    return {
      status: "error",
      message:
        "Revise o número decimal: de 1 a 4 casas, e limites com no máximo essas casas, entre -1.000.000.000 e 1.000.000.000, com o mínimo até o máximo.",
    };
  }
  // On creation a conflict is only the limit or a repeated label, with the message it already had.
  if (kind === "update" && error instanceof ApplicationError && error.code === "CONFLICT") {
    return {
      status: "error",
      message:
        "Não foi possível salvar: o serviço já tem o limite de campos ativos, outro campo ativo usa o mesmo rótulo, ou a mudança quebraria a condição de outro campo.",
    };
  }
  return null;
}

/**
 * Approval form of a service (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1, 4.3.6 and
 * 4.3.7). The chosen levels in order, without the empty ones; one level equal to the service's sector
 * is sent as no level (the default). The condition is "<field id>::<value>" or empty. Blank days
 * mean no deadline; other text goes on for the server to refuse.
 */
export function serviceApprovalFields(formData: FormData) {
  const levels = ["level1", "level2", "level3"].map((name) => field(formData, name).trim()).filter((value) => value !== "");
  const sectorIds = levels.length === 1 && levels[0] === field(formData, "serviceSectorId") ? [] : levels;
  const condition = field(formData, "condition");
  const separator = condition.indexOf("::");
  const days = field(formData, "deadlineDays").trim();

  return {
    sectorIds,
    conditionFieldId: condition === "" ? null : separator < 0 ? condition : condition.slice(0, separator),
    conditionValue: separator < 0 ? null : condition.slice(separator + 2),
    deadlineDays: days === "" ? null : /^\d+$/.test(days) ? Number(days) : days,
  };
}

/**
 * Settings form of a stage (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3): empty attendant
 * and blank days mean none; the condition is "<field id>::<value>" or empty.
 */
export function serviceStageSettingsFields(formData: FormData) {
  const assignee = field(formData, "assigneeId").trim();
  const days = field(formData, "targetDays").trim();
  const condition = field(formData, "condition");
  const separator = condition.indexOf("::");

  return {
    assigneeId: assignee === "" ? null : assignee,
    targetDays: days === "" ? null : /^\d+$/.test(days) ? Number(days) : days,
    conditionFieldId: condition === "" ? null : separator < 0 ? condition : condition.slice(0, separator),
    conditionValue: separator < 0 ? null : condition.slice(separator + 2),
  };
}

/** Fixed messages for the stage settings form (5.3). */
export function serviceStageSettingsFailure(error: unknown): AdminUpdateState | null {
  if (!(error instanceof ValidationError)) return null;
  const paths = error.issues.map(({ path }) => String(path[0]));
  if (paths.includes("assigneeId")) {
    return { status: "error", message: "Escolha um atendente ativo do setor do serviço, ou nenhum." };
  }
  if (paths.includes("targetDays")) {
    return { status: "error", message: "Informe de 1 a 30 dias para a etapa, ou deixe em branco para não ter prazo." };
  }
  if (paths.includes("conditionFieldId") || paths.includes("conditionValue")) {
    return {
      status: "error",
      message: "Escolha uma condição válida: um campo de escolha ativo da abertura, sem condição própria, e uma das suas opções.",
    };
  }
  return null;
}

/** Fixed messages for the approval form (4.3.1, 4.3.6 and 4.3.7). */
export function serviceApprovalFailure(error: unknown): AdminUpdateState | null {
  if (!(error instanceof ValidationError)) return null;
  const paths = error.issues.map(({ path }) => String(path[0]));
  if (paths.includes("sectorIds")) {
    return { status: "error", message: "Escolha de 1 a 3 setores ativos, sem repetir o mesmo setor em dois níveis seguidos." };
  }
  if (paths.includes("conditionFieldId") || paths.includes("conditionValue")) {
    return {
      status: "error",
      message: "Escolha uma condição válida: um campo de escolha ativo da abertura, sem condição própria, e uma das suas opções.",
    };
  }
  if (paths.includes("deadlineDays")) {
    return { status: "error", message: "Informe de 1 a 30 dias para decidir cada nível, ou deixe em branco para não ter prazo." };
  }
  return null;
}

export function activeState(formData: FormData): boolean {
  return validateInput(activeStateInputSchema, field(formData, "isActive"));
}

/** A refused end (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2) has its own message. */
export function isValidityFailure(error: unknown): boolean {
  return error instanceof ValidationError && error.issues.some(({ path }) => path.includes("expiresOn"));
}

/** Which message a refused escalation rule gets (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3). */
export function escalationRuleFailureEntity(error: unknown): Entity {
  if (!(error instanceof ValidationError)) return "escalationRules";
  const paths = error.issues.map(({ path }) => String(path[0]));
  if (paths.includes("overdueDays")) return "escalationRuleDays";
  if (paths.includes("actions")) return "escalationRuleEmpty";
  if (paths.includes("assignToId") || paths.includes("notifyUserIds")) return "escalationRulePeople";
  return "escalationRules";
}

export function selectedSection(formData: FormData): AdminSection {
  const section = field(formData, "section");
  return section === "users" ||
    section === "sectors" ||
    section === "categories" ||
    section === "services" ||
    section === "sector-services" ||
    section === "api-tokens" ||
    section === "webhooks" ||
    section === "calendar" ||
    section === "roles" ||
    section === "bundles"
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
    redirect(`${pageFor(section)}error=${code}&entity=${entity}`);
  }

  throw error;
}

export async function finish(
  entity: Entity,
  message: string,
  section: AdminSection,
): Promise<never> {
  revalidatePath(section === "sector-services" ? "/sector-services" : "/admin");
  redirect(`${pageFor(section)}notice=${message}&entity=${entity}`);
}
