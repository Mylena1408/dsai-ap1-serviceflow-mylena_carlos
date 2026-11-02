import { createHash, randomBytes } from "node:crypto";

// Personal API tokens (SPEC 2026-11-02-api-externa-webhooks, 5.1 to 5.3; decisions A1 to A3).

export const API_TOKEN_PREFIX = "sf_";
const TOKEN_BYTES = 32;
/** 32 bytes in base64url without padding: 43 characters. */
const TOKEN_PATTERN = /^sf_[A-Za-z0-9_-]{43}$/;

export type ApiTokenScope = "READ" | "WRITE";
export const API_TOKEN_SCOPES: readonly ApiTokenScope[] = ["READ", "WRITE"];
export const API_TOKEN_SCOPE_LABELS: Record<ApiTokenScope, string> = {
  READ: "Somente leitura",
  WRITE: "Leitura e escrita",
};

export const API_TOKEN_VALIDITY_DAYS = [30, 90, 365] as const;
export type ApiTokenValidityDays = (typeof API_TOKEN_VALIDITY_DAYS)[number];
export const DEFAULT_API_TOKEN_VALIDITY_DAYS: ApiTokenValidityDays = 90;

export const MAX_ACTIVE_API_TOKENS = 10;
export const API_TOKEN_NAME_MAX_LENGTH = 60;
/** Last use is written at most once a minute per token (5.1). */
export const LAST_USE_INTERVAL_MS = 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ApiTokenOwnerRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
/** Decision A1: the administrator sees and revokes every token but owns none. */
export const API_TOKEN_OWNER_ROLES: readonly ApiTokenOwnerRole[] = ["REQUESTER", "ATTENDANT", "MANAGER"];

export interface GeneratedApiToken {
  /** Shown once to the person; never stored. */
  value: string;
  hash: string;
  lastFour: string;
}

export function hashApiToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateApiToken(random: (size: number) => Buffer = randomBytes): GeneratedApiToken {
  const value = API_TOKEN_PREFIX + random(TOKEN_BYTES).toString("base64url");
  return { value, hash: hashApiToken(value), lastFour: value.slice(-4) };
}

/**
 * The token of an `Authorization: Bearer sf_...` header, or null for anything else (5.3). The
 * format is checked before any lookup, so malformed values never reach the database.
 */
export function bearerApiToken(authorization: string | null | undefined): string | null {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  return match && TOKEN_PATTERN.test(match[1]!) ? match[1]! : null;
}

export function apiTokenExpiry(createdAt: Date, validityDays: ApiTokenValidityDays): Date {
  return new Date(createdAt.getTime() + validityDays * DAY_MS);
}

export function isApiTokenValidityDays(value: unknown): value is ApiTokenValidityDays {
  return API_TOKEN_VALIDITY_DAYS.includes(value as ApiTokenValidityDays);
}

/** The trimmed name, or null when it is empty or longer than 60 characters. */
export function normalizeApiTokenName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && [...name].length <= API_TOKEN_NAME_MAX_LENGTH ? name : null;
}

export type ApiTokenCreationRefusal = "role" | "inactive" | "limit";

/** Why a person may not create another token (5.1), or null when she may. */
export function apiTokenCreationRefusal(owner: {
  role: ApiTokenOwnerRole;
  isActive: boolean;
  anonymized: boolean;
  activeTokenCount: number;
}): ApiTokenCreationRefusal | null {
  if (!API_TOKEN_OWNER_ROLES.includes(owner.role)) return "role";
  if (!owner.isActive || owner.anonymized) return "inactive";
  if (owner.activeTokenCount >= MAX_ACTIVE_API_TOKENS) return "limit";
  return null;
}

export interface ApiTokenState {
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Active means neither revoked nor expired; the limit of 10 counts only active tokens. */
export function isApiTokenActive(token: ApiTokenState, now: Date): boolean {
  return token.revokedAt === null && token.expiresAt.getTime() > now.getTime();
}

/**
 * Whether a call may use the token (5.1): active token whose owner is active, not anonymized
 * and still has a profile that owns tokens. Owner and profile come from the database on every call.
 */
export function canAuthenticateWithApiToken(
  token: ApiTokenState,
  owner: { role: ApiTokenOwnerRole; isActive: boolean; anonymized: boolean },
  now: Date,
): boolean {
  return (
    isApiTokenActive(token, now) &&
    owner.isActive &&
    !owner.anonymized &&
    API_TOKEN_OWNER_ROLES.includes(owner.role)
  );
}

/** Decision A2: a read-only token only reads. */
export function apiTokenAllows(scope: ApiTokenScope, method: string): boolean {
  return scope === "WRITE" || method.toUpperCase() === "GET";
}

export function shouldRecordApiTokenUse(lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt === null || now.getTime() - lastUsedAt.getTime() >= LAST_USE_INTERVAL_MS;
}
