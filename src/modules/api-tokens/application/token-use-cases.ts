import { z } from "zod";
import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  API_TOKEN_NAME_MAX_LENGTH,
  API_TOKEN_OWNER_ROLES,
  apiTokenCreationRefusal,
  apiTokenExpiry,
  generateApiToken,
  isApiTokenValidityDays,
  type ApiTokenOwnerRole,
  type ApiTokenValidityDays,
} from "../domain/token";
import type { AdminApiTokenRecord, ApiTokenReader, ApiTokenRecord, ApiTokenTransactionRunner } from "./ports";

// Personal API tokens (SPEC 2026-11-02-api-externa-webhooks, 5.1, 5.7 and 5.8; decisions A1 to
// A3). The owner is always the signed-in person: no input names a user.

const createTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(API_TOKEN_NAME_MAX_LENGTH),
    scope: z.enum(["READ", "WRITE"]),
    validityDays: z.coerce.number().refine(isApiTokenValidityDays),
  })
  .strict();

const revokeTokenSchema = z.object({ tokenId: entityIdSchema }).strict();

export interface CreatedApiToken {
  /** Shown once, right after the creation (5.1). */
  value: string;
  token: ApiTokenRecord;
}

async function requireTokenOwner(): Promise<AuthorizationActor> {
  const actor = await requireCurrentActor();
  if (!API_TOKEN_OWNER_ROLES.includes(actor.role as ApiTokenOwnerRole)) {
    throw new AuthorizationError();
  }
  return actor;
}

export async function listOwnApiTokens(reader: ApiTokenReader): Promise<ApiTokenRecord[]> {
  const actor = await requireTokenOwner();
  return reader.listOwn(actor.id);
}

/** Every token of the organization, for the administrator (5.8): never values or hashes. */
export async function listAllApiTokens(reader: ApiTokenReader): Promise<AdminApiTokenRecord[]> {
  const actor = await requireCurrentActor();
  if (actor.role !== "ADMIN") {
    throw new AuthorizationError();
  }
  return reader.listAll();
}

/**
 * Creates a token for the signed-in person. More than 10 active tokens is a conflict; an
 * administrator owns none (A1). The creation is recorded in the audit without value or hash.
 */
export async function createApiToken(input: unknown, transactions: ApiTokenTransactionRunner): Promise<CreatedApiToken> {
  const actor = await requireTokenOwner();
  const { name, scope, validityDays } = validateInput(createTokenSchema, input);
  const generated = generateApiToken();

  return transactions.run(async (transaction) => {
    const owner = await transaction.findOwner(actor.id);
    if (!owner) throw new AuthorizationError();

    const now = await transaction.currentTime();
    const refusal = apiTokenCreationRefusal({
      role: owner.role,
      isActive: owner.isActive,
      anonymized: owner.anonymizedAt !== null,
      activeTokenCount: await transaction.countActiveTokens(owner.id, now),
    });
    if (refusal === "limit") throw new ConflictError();
    if (refusal) throw new AuthorizationError();

    const expiresAt = apiTokenExpiry(now, validityDays as ApiTokenValidityDays);
    const created = await transaction.audited({ actor, action: "CREATED", entityType: "API_TOKEN" }, () =>
      transaction.insertToken({
        userId: owner.id,
        name,
        scope,
        tokenHash: generated.hash,
        lastFour: generated.lastFour,
        createdAt: now,
        expiresAt,
      }),
    );

    return {
      value: generated.value,
      token: {
        id: created.id,
        name,
        scope,
        lastFour: generated.lastFour,
        createdAt: now,
        expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        revokedByName: null,
      },
    };
  });
}

/**
 * Revokes a token at once and for good (5.1): the owner revokes her own tokens, the
 * administrator any token. Someone else's token reads as not found. Revoking again changes nothing.
 */
export async function revokeApiToken(input: unknown, transactions: ApiTokenTransactionRunner): Promise<void> {
  const actor = await requireCurrentActor();
  const { tokenId } = validateInput(revokeTokenSchema, input);

  await transactions.run(async (transaction) => {
    const token = await transaction.findToken(tokenId);
    if (!token || (actor.role !== "ADMIN" && token.userId !== actor.id)) {
      throw new NotFoundError();
    }
    if (token.revokedAt) return;

    const now = await transaction.currentTime();
    await transaction.audited({ actor, action: "REVOKED", entityType: "API_TOKEN", entityId: token.id }, () =>
      transaction.revokeToken(token.id, actor.id, now),
    );
  });
}
