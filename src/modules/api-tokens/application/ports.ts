import type { AuditScope } from "@/modules/audit";
import type { ApiTokenOwnerRole, ApiTokenScope } from "../domain/token";

// Persistence of the personal API tokens (SPEC 2026-11-02-api-externa-webhooks, 5.1 to 5.5).

/** A token as listed on the screens: never its value or hash. */
export interface ApiTokenRecord {
  id: string;
  name: string;
  scope: ApiTokenScope;
  lastFour: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** Name of who revoked it (the owner or an administrator). */
  revokedByName: string | null;
}

/** The administrator's list adds the owner. */
export interface AdminApiTokenRecord extends ApiTokenRecord {
  owner: { id: string; name: string; role: ApiTokenOwnerRole };
}

export interface ApiTokenOwnerState {
  id: string;
  role: ApiTokenOwnerRole;
  isActive: boolean;
  anonymizedAt: Date | null;
}

export interface NewApiToken {
  userId: string;
  name: string;
  scope: ApiTokenScope;
  tokenHash: string;
  lastFour: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ApiTokenTransaction extends AuditScope {
  /** Database clock, the same that dates the audit entries. */
  currentTime(): Promise<Date>;
  findOwner(userId: string): Promise<ApiTokenOwnerState | null>;
  countActiveTokens(userId: string, now: Date): Promise<number>;
  insertToken(token: NewApiToken): Promise<{ id: string }>;
  findToken(tokenId: string): Promise<{ id: string; userId: string; revokedAt: Date | null } | null>;
  revokeToken(tokenId: string, revokedById: string, at: Date): Promise<{ id: string }>;
}

export interface ApiTokenTransactionRunner {
  run<T>(work: (transaction: ApiTokenTransaction) => Promise<T>): Promise<T>;
}

export interface ApiTokenReader {
  listOwn(userId: string): Promise<ApiTokenRecord[]>;
  listAll(): Promise<AdminApiTokenRecord[]>;
}

/** What a call needs to authenticate (5.3): the token by its hash, with its owner read now. */
export interface ApiTokenCredential {
  id: string;
  scope: ApiTokenScope;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  owner: {
    id: string;
    name: string;
    email: string;
    role: ApiTokenOwnerRole;
    sectorId: string | null;
    /** For "GET /api/v1/me" (5.4). */
    sectorName: string | null;
    isActive: boolean;
    anonymizedAt: Date | null;
  };
}

export interface ApiCallStore {
  findByHash(tokenHash: string): Promise<ApiTokenCredential | null>;
  /** Adds one call to the window and returns the window's count including it (atomic). */
  countCall(tokenId: string, windowStart: Date): Promise<number>;
  recordUse(tokenId: string, at: Date): Promise<void>;
}
