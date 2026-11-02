"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiToken, revokeApiToken } from "@/modules/api-tokens";
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// "Acesso à API" (SPEC 2026-11-02-api-externa-webhooks, 5.1). The new value goes back only in the
// action's answer, shown once on the screen: never in the URL, the database or a log.

export interface ApiTokenCreationState {
  status: "idle" | "created" | "error";
  message: string;
  /** Only right after the creation. */
  value?: string;
  name?: string;
}

const PAGE = "/account/api-tokens";

export async function createApiTokenAction(
  _previous: ApiTokenCreationState,
  formData: FormData,
): Promise<ApiTokenCreationState> {
  try {
    const { value, token } = await createApiToken({
      name: String(formData.get("name") ?? ""),
      scope: String(formData.get("scope") ?? ""),
      validityDays: String(formData.get("validityDays") ?? ""),
    });
    revalidatePath(PAGE);
    return { status: "created", message: "Token criado.", value, name: token.name };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) redirect("/");
    if (error instanceof ConflictError) {
      return { status: "error", message: "Você já tem 10 tokens ativos. Revogue um antes de criar outro." };
    }
    if (error instanceof ValidationError) {
      return { status: "error", message: "Informe um nome de até 60 caracteres, o escopo e a validade da lista." };
    }
    throw error;
  }
}

export async function revokeOwnApiTokenAction(formData: FormData): Promise<never> {
  let notice = "revoked";

  try {
    await revokeApiToken({ tokenId: String(formData.get("tokenId") ?? "") });
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) redirect("/");
    if (!(error instanceof NotFoundError || error instanceof ValidationError)) throw error;
    notice = "not-found";
  }

  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${notice}`);
}
