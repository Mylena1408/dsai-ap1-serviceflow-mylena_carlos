import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { createApiToken, listAllApiTokens, listOwnApiTokens, revokeApiToken } from "@/modules/api-tokens/application/token-use-cases";
import { authenticateApiCall } from "@/modules/api-tokens/application/authenticate-call";
import type { ApiCallStore, ApiTokenCredential, ApiTokenTransaction, ApiTokenTransactionRunner } from "@/modules/api-tokens/application/ports";
import type { AuditMeta } from "@/modules/audit";
import { generateApiToken } from "@/modules/api-tokens";

// SPEC 2026-11-02-api-externa-webhooks, 5.1 to 5.5 and 5.7 (SF-112; CA-API-02, 03 and 08).

const now = new Date("2026-11-02T15:00:30.000Z");
const ana = { id: "11111111-1111-4111-8111-111111111111", role: "REQUESTER" as const, sectorId: null, isActive: true };
const admin = { id: "22222222-2222-4222-8222-222222222222", role: "ADMIN" as const, sectorId: null, isActive: true };
const tokenId = "33333333-3333-4333-8333-333333333333";

function memoryTransactions(state: { activeTokens?: number; ownerActive?: boolean; tokenOwner?: string; revokedAt?: Date | null } = {}) {
  const audits: AuditMeta[] = [];
  const inserted: unknown[] = [];
  const revoked: Array<{ tokenId: string; by: string }> = [];
  const transaction: ApiTokenTransaction = {
    async audited(meta, change) {
      audits.push(meta);
      return change();
    },
    currentTime: async () => now,
    findOwner: async (id) => ({ id, role: id === admin.id ? "ADMIN" : "REQUESTER", isActive: state.ownerActive ?? true, anonymizedAt: null }),
    countActiveTokens: async () => state.activeTokens ?? 0,
    insertToken: async (token) => {
      inserted.push(token);
      return { id: tokenId };
    },
    findToken: async (id) => (id === tokenId ? { id, userId: state.tokenOwner ?? ana.id, revokedAt: state.revokedAt ?? null } : null),
    revokeToken: async (id, by) => {
      revoked.push({ tokenId: id, by });
      return { id };
    },
  };
  const runner: ApiTokenTransactionRunner = { run: (work) => work(transaction) };
  return { runner, audits, inserted, revoked };
}

describe("API token use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue(ana);
  });

  it("creates a token for the signed-in person, returns the value once and audits without it (CA-API-02)", async () => {
    const { runner, audits, inserted } = memoryTransactions();

    const created = await createApiToken({ name: "  Portal  ", scope: "WRITE", validityDays: "30" }, runner);

    expect(created.value).toMatch(/^sf_/);
    expect(created.token).toMatchObject({ id: tokenId, name: "Portal", scope: "WRITE", lastFour: created.value.slice(-4) });
    expect(created.token.expiresAt.toISOString()).toBe("2026-12-02T15:00:30.000Z");
    expect(inserted).toEqual([expect.objectContaining({ userId: ana.id, name: "Portal", tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(JSON.stringify(inserted)).not.toContain(created.value);
    expect(audits).toEqual([{ actor: ana, action: "CREATED", entityType: "API_TOKEN" }]);
  });

  it("refuses the 11th active token, an administrator and invalid input", async () => {
    await expect(createApiToken({ name: "x", scope: "READ", validityDays: 90 }, memoryTransactions({ activeTokens: 10 }).runner)).rejects.toThrow(ConflictError);

    for (const input of [
      { name: "", scope: "READ", validityDays: 90 },
      { name: "x".repeat(61), scope: "READ", validityDays: 90 },
      { name: "x", scope: "ADMIN", validityDays: 90 },
      { name: "x", scope: "READ", validityDays: 7 },
      { name: "x", scope: "READ", validityDays: 90, userId: admin.id },
    ]) {
      await expect(createApiToken(input, memoryTransactions().runner), JSON.stringify(input)).rejects.toThrow(ValidationError);
    }

    authorization.requireCurrentActor.mockResolvedValue(admin);
    await expect(createApiToken({ name: "x", scope: "READ", validityDays: 90 }, memoryTransactions().runner)).rejects.toThrow(AuthorizationError);
  });

  it("lets the owner revoke her token and the administrator any token, once", async () => {
    const own = memoryTransactions();
    await revokeApiToken({ tokenId }, own.runner);
    expect(own.revoked).toEqual([{ tokenId, by: ana.id }]);
    expect(own.audits).toEqual([{ actor: ana, action: "REVOKED", entityType: "API_TOKEN", entityId: tokenId }]);

    authorization.requireCurrentActor.mockResolvedValue(admin);
    const byAdmin = memoryTransactions();
    await revokeApiToken({ tokenId }, byAdmin.runner);
    expect(byAdmin.revoked).toEqual([{ tokenId, by: admin.id }]);

    const again = memoryTransactions({ revokedAt: now });
    await revokeApiToken({ tokenId }, again.runner);
    expect(again.revoked).toEqual([]);
    expect(again.audits).toEqual([]);
  });

  it("hides someone else's token as not found", async () => {
    authorization.requireCurrentActor.mockResolvedValue({ ...ana, id: "44444444-4444-4444-8444-444444444444" });
    await expect(revokeApiToken({ tokenId }, memoryTransactions().runner)).rejects.toThrow(NotFoundError);
    await expect(revokeApiToken({ tokenId: "55555555-5555-4555-8555-555555555555" }, memoryTransactions().runner)).rejects.toThrow(NotFoundError);
  });

  it("lists the own tokens for owners and every token only for the administrator", async () => {
    const reader = { listOwn: vi.fn(async () => []), listAll: vi.fn(async () => []) };

    await listOwnApiTokens(reader);
    expect(reader.listOwn).toHaveBeenCalledWith(ana.id);
    await expect(listAllApiTokens(reader)).rejects.toThrow(AuthorizationError);

    authorization.requireCurrentActor.mockResolvedValue(admin);
    await listAllApiTokens(reader);
    expect(reader.listAll).toHaveBeenCalled();
    await expect(listOwnApiTokens(reader)).rejects.toThrow(AuthorizationError);
  });
});

describe("authentication of an API call", () => {
  const value = generateApiToken().value;

  function store(credential: Partial<ApiTokenCredential> | null, count = 1) {
    const used: Date[] = [];
    const calls: Array<{ tokenId: string; windowStart: Date }> = [];
    const memory: ApiCallStore = {
      findByHash: async () =>
        credential && {
          id: tokenId,
          scope: "READ",
          expiresAt: new Date(now.getTime() + 60_000),
          revokedAt: null,
          lastUsedAt: null,
          ...credential,
          owner: { id: ana.id, name: "Ana Souza", email: "ana@exemplo.test", role: "REQUESTER", sectorId: null, isActive: true, anonymizedAt: null, ...credential.owner },
        },
      countCall: async (id, windowStart) => {
        calls.push({ tokenId: id, windowStart });
        return count;
      },
      recordUse: async (_id, at) => {
        used.push(at);
      },
    };
    return { memory, used, calls };
  }

  it("authenticates the owner read now, counts the call and records the use", async () => {
    const { memory, used, calls } = store({});

    await expect(authenticateApiCall({ authorization: `Bearer ${value}`, method: "GET" }, memory, now)).resolves.toEqual({
      ok: true,
      tokenId,
      scope: "READ",
      user: { id: ana.id, name: "Ana Souza", email: "ana@exemplo.test", role: "REQUESTER", sectorId: null, isActive: true },
    });
    expect(calls).toEqual([{ tokenId, windowStart: new Date("2026-11-02T15:00:00.000Z") }]);
    expect(used).toEqual([now]);
  });

  it("gives the same answer for every invalid token (CA-API-03)", async () => {
    const cases: Array<[string | null, Partial<ApiTokenCredential> | null]> = [
      [null, {}],
      ["Bearer sf_curto", {}],
      [`Bearer ${value}`, null],
      [`Bearer ${value}`, { revokedAt: now }],
      [`Bearer ${value}`, { expiresAt: now }],
      [`Bearer ${value}`, { owner: { isActive: false } as ApiTokenCredential["owner"] }],
      [`Bearer ${value}`, { owner: { anonymizedAt: now } as ApiTokenCredential["owner"] }],
      [`Bearer ${value}`, { owner: { role: "ADMIN" } as ApiTokenCredential["owner"] }],
    ];

    for (const [header, credential] of cases) {
      const { memory, calls } = store(credential);
      await expect(authenticateApiCall({ authorization: header, method: "GET" }, memory, now)).resolves.toEqual({
        ok: false,
        error: "invalid_token",
      });
      expect(calls).toEqual([]);
    }
  });

  it("refuses writes with a read-only token after counting the call (CA-API-04)", async () => {
    const { memory, calls } = store({});
    await expect(authenticateApiCall({ authorization: `Bearer ${value}`, method: "POST" }, memory, now)).resolves.toEqual({
      ok: false,
      error: "insufficient_scope",
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses the 61st call of the minute with the wait (CA-API-08)", async () => {
    const { memory, used } = store({ scope: "WRITE" }, 61);
    await expect(authenticateApiCall({ authorization: `Bearer ${value}`, method: "POST" }, memory, now)).resolves.toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: 30,
    });
    expect(used).toEqual([]);
  });

  it("records the last use at most once a minute", async () => {
    const { memory, used } = store({ lastUsedAt: new Date(now.getTime() - 30_000) });
    await authenticateApiCall({ authorization: `Bearer ${value}`, method: "GET" }, memory, now);
    expect(used).toEqual([]);
  });
});
