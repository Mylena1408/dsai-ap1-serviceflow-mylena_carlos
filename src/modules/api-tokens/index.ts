import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as authentication from "./application/authenticate-call";
import * as tokens from "./application/token-use-cases";
import type { AdminApiTokenRecord, ApiTokenRecord } from "./application/ports";
import * as persistence from "./infrastructure/prisma-api-tokens";
import {
  createPrismaApiCallStore,
  createPrismaApiTokenReader,
  createPrismaApiTokenTransactionRunner,
} from "./infrastructure/prisma-api-tokens";

// Public API of the API tokens module (SPEC 2026-11-02-api-externa-webhooks).
export {
  API_TOKEN_OWNER_ROLES,
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPE_LABELS,
  API_TOKEN_SCOPES,
  API_TOKEN_VALIDITY_DAYS,
  DEFAULT_API_TOKEN_VALIDITY_DAYS,
  MAX_ACTIVE_API_TOKENS,
  apiTokenAllows,
  apiTokenCreationRefusal,
  apiTokenExpiry,
  bearerApiToken,
  canAuthenticateWithApiToken,
  generateApiToken,
  hashApiToken,
  isApiTokenActive,
  isApiTokenValidityDays,
  normalizeApiTokenName,
  shouldRecordApiTokenUse,
} from "./domain/token";
export type {
  ApiTokenCreationRefusal,
  ApiTokenScope,
  ApiTokenValidityDays,
  GeneratedApiToken,
} from "./domain/token";
export { API_CALLS_PER_MINUTE, RATE_WINDOW_RETENTION_MS, rateDecision, rateWindowStart } from "./domain/rate-limit";
export type { RateDecision } from "./domain/rate-limit";
export type { AdminApiTokenRecord, ApiTokenRecord } from "./application/ports";
export type { ApiCallAuthentication, ApiUser } from "./application/authenticate-call";
export type { CreatedApiToken } from "./application/token-use-cases";

/** "Acesso à API" of the signed-in requester, attendant or manager (5.1). */
export async function listOwnApiTokens(database: PrismaClient = prisma): Promise<ApiTokenRecord[]> {
  return tokens.listOwnApiTokens(createPrismaApiTokenReader(database));
}

/** "Acesso à API" of the administration (5.8). */
export async function listAllApiTokens(database: PrismaClient = prisma): Promise<AdminApiTokenRecord[]> {
  return tokens.listAllApiTokens(createPrismaApiTokenReader(database));
}

export async function createApiToken(input: unknown, database: PrismaClient = prisma): Promise<tokens.CreatedApiToken> {
  return tokens.createApiToken(input, createPrismaApiTokenTransactionRunner(database));
}

export async function revokeApiToken(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return tokens.revokeApiToken(input, createPrismaApiTokenTransactionRunner(database));
}

/** Authentication of one /api/v1 call by its `Authorization` header (5.3 and 5.5). */
export async function authenticateApiRequest(
  request: Pick<Request, "headers" | "method">,
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<authentication.ApiCallAuthentication> {
  return authentication.authenticateApiCall(
    { authorization: request.headers.get("authorization"), method: request.method },
    createPrismaApiCallStore(database),
    now,
  );
}

/** Retention (5.7): call windows of more than one day. */
export async function purgeApiRateWindows(before: Date, database: PrismaClient = prisma): Promise<number> {
  return persistence.purgeApiRateWindows(database, before);
}

/** Retention (5.7): tokens revoked or expired more than 365 days ago. */
export async function purgeEndedApiTokens(before: Date, database: PrismaClient = prisma): Promise<number> {
  return persistence.purgeEndedApiTokens(database, before);
}
