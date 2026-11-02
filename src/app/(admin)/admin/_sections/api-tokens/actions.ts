"use server";

import { revokeApiToken } from "@/modules/api-tokens";
import { field, finish, reportFailure } from "../../_shared/action-helpers";

/** The administrator revokes any token (SPEC 2026-11-02-api-externa-webhooks, 5.1 and 5.8). */
export async function revokeApiTokenAsAdminAction(formData: FormData): Promise<never> {
  try {
    await revokeApiToken({ tokenId: field(formData, "tokenId") });
  } catch (error) {
    reportFailure("apiTokens", "api-tokens", error);
  }
  return finish("apiTokens", "revoked", "api-tokens");
}
