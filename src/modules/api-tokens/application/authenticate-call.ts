import { rateDecision, rateWindowStart } from "../domain/rate-limit";
import {
  apiTokenAllows,
  bearerApiToken,
  canAuthenticateWithApiToken,
  hashApiToken,
  shouldRecordApiTokenUse,
  type ApiTokenOwnerRole,
  type ApiTokenScope,
} from "../domain/token";
import type { ApiCallStore } from "./ports";

// Authentication of a call to /api/v1 (SPEC 2026-11-02-api-externa-webhooks, 5.1 to 5.5).

/** The token owner, read from the database for this call, as the rest of the system sees a user. */
export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: ApiTokenOwnerRole;
  sectorId: string | null;
  isActive: true;
}

export type ApiCallAuthentication =
  | { ok: true; user: ApiUser; tokenId: string; scope: ApiTokenScope }
  | { ok: false; error: "invalid_token" }
  | { ok: false; error: "insufficient_scope" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

/**
 * Every refusal of an unknown, malformed, expired or revoked token, or of an inactive or
 * anonymized owner, is the same `invalid_token` (5.3), so the answer never tells which one. A
 * valid token counts the call before the scope check (5.5): a refused write still counts.
 */
export async function authenticateApiCall(
  call: { authorization: string | null; method: string },
  store: ApiCallStore,
  now: Date = new Date(),
): Promise<ApiCallAuthentication> {
  const value = bearerApiToken(call.authorization);
  const credential = value ? await store.findByHash(hashApiToken(value)) : null;

  if (
    !credential ||
    !canAuthenticateWithApiToken(
      credential,
      {
        role: credential.owner.role,
        isActive: credential.owner.isActive,
        anonymized: credential.owner.anonymizedAt !== null,
      },
      now,
    )
  ) {
    return { ok: false, error: "invalid_token" };
  }

  const decision = rateDecision(await store.countCall(credential.id, rateWindowStart(now)), now);
  if (!decision.allowed) {
    return { ok: false, error: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  if (!apiTokenAllows(credential.scope, call.method)) {
    return { ok: false, error: "insufficient_scope" };
  }

  if (shouldRecordApiTokenUse(credential.lastUsedAt, now)) {
    await store.recordUse(credential.id, now);
  }

  const { owner } = credential;
  return {
    ok: true,
    tokenId: credential.id,
    scope: credential.scope,
    user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role, sectorId: owner.sectorId, isActive: true },
  };
}
