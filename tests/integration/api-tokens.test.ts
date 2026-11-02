import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import { createDomainSector, createDomainUser } from "./domain-fixtures";
import { ConflictError, NotFoundError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  API_CALLS_PER_MINUTE,
  authenticateApiRequest,
  createApiToken,
  listAllApiTokens,
  listOwnApiTokens,
  revokeApiToken,
} from "@/modules/api-tokens";
import { getCurrentUser, runAsApiUser } from "@/server/auth";

// SPEC 2026-11-02-api-externa-webhooks, 5.1 to 5.5 and 5.7 (SF-112; CA-API-02, 03, 08 and the token
// part of CA-API-12).

const now = new Date();

function call(value: string | null, method = "GET") {
  return new Request("https://serviceflow.test/api/v1/me", {
    method,
    headers: value ? { authorization: `Bearer ${value}` } : {},
  });
}

async function signedIn(user: { id: string; role: string; sectorId: string | null }) {
  authorization.requireCurrentActor.mockResolvedValue({ ...user, isActive: true });
}

describe("API tokens (SF-112)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates, lists and revokes, keeping only the hash and auditing without the value (CA-API-02, 12)", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    const admin = await createDomainUser({ role: "ADMIN" });
    await signedIn(owner);

    const created = await createApiToken({ name: "Portal", scope: "READ", validityDays: "90" }, prisma);
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: created.token.id } });

    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.value);
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000)).toBe(90);
    await expect(listOwnApiTokens(prisma)).resolves.toEqual([
      expect.objectContaining({ id: row.id, name: "Portal", scope: "READ", lastFour: created.value.slice(-4), revokedAt: null }),
    ]);

    await signedIn(admin);
    await expect(listAllApiTokens(prisma)).resolves.toEqual([
      expect.objectContaining({ id: row.id, owner: { id: owner.id, name: "Domain test user", role: "REQUESTER" } }),
    ]);
    await revokeApiToken({ tokenId: row.id }, prisma);
    await expect(prisma.apiToken.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({ revokedById: admin.id });

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "API_TOKEN" }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action, actorId, entityLabel }) => ({ action, actorId, entityLabel }))).toEqual([
      { action: "CREATED", actorId: owner.id, entityLabel: "Portal" },
      { action: "REVOKED", actorId: admin.id, entityLabel: "Portal" },
    ]);
    const recorded = JSON.stringify(entries);
    expect(recorded).not.toContain(created.value);
    expect(recorded).not.toContain(row.tokenHash);
    expect(recorded).not.toContain("tokenHash");
  });

  it("allows 10 active tokens; revoked ones do not count", async () => {
    const owner = await createDomainUser({ role: "MANAGER", sectorId: (await createDomainSector()).id });
    await signedIn(owner);

    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      ids.push((await createApiToken({ name: `Token ${index}`, scope: "READ", validityDays: 30 }, prisma)).token.id);
    }
    await expect(createApiToken({ name: "Token 11", scope: "READ", validityDays: 30 }, prisma)).rejects.toThrow(ConflictError);

    await revokeApiToken({ tokenId: ids[0] }, prisma);
    await expect(createApiToken({ name: "Token 11", scope: "READ", validityDays: 30 }, prisma)).resolves.toBeTruthy();
  });

  it("does not let a person see or revoke someone else's token", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    const other = await createDomainUser({ role: "REQUESTER" });
    await signedIn(owner);
    const { token } = await createApiToken({ name: "Portal", scope: "READ", validityDays: 30 }, prisma);

    await signedIn(other);
    await expect(listOwnApiTokens(prisma)).resolves.toEqual([]);
    await expect(revokeApiToken({ tokenId: token.id }, prisma)).rejects.toThrow(NotFoundError);
    await expect(prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })).resolves.toMatchObject({ revokedAt: null });
  });

  it("authenticates by the header, with the owner and profile read on every call (CA-API-03)", async () => {
    const sector = await createDomainSector();
    const owner = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    await signedIn(owner);
    const { value, token } = await createApiToken({ name: "Fila", scope: "WRITE", validityDays: 30 }, prisma);

    const first = await authenticateApiRequest(call(value), prisma, now);
    expect(first).toMatchObject({ ok: true, tokenId: token.id, scope: "WRITE", user: { id: owner.id, role: "ATTENDANT", sectorId: sector.id } });
    await expect(prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })).resolves.toMatchObject({ lastUsedAt: now });

    // A new sector counts on the next call.
    const other = await createDomainSector();
    await prisma.user.update({ where: { id: owner.id }, data: { sectorId: other.id } });
    await expect(authenticateApiRequest(call(value), prisma, now)).resolves.toMatchObject({ ok: true, user: { sectorId: other.id } });

    const invalid = { ok: false, error: "invalid_token" };
    await expect(authenticateApiRequest(call(null), prisma, now)).resolves.toEqual(invalid);
    await expect(authenticateApiRequest(call(`${value.slice(0, -1)}x`), prisma, now)).resolves.toEqual(invalid);

    await prisma.user.update({ where: { id: owner.id }, data: { role: "ADMIN", sectorId: null } });
    await expect(authenticateApiRequest(call(value), prisma, now)).resolves.toEqual(invalid);
    await prisma.user.update({ where: { id: owner.id }, data: { role: "ATTENDANT", sectorId: sector.id, isActive: false } });
    await expect(authenticateApiRequest(call(value), prisma, now)).resolves.toEqual(invalid);
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: true } });
    await expect(authenticateApiRequest(call(value), prisma, new Date(now.getTime() + 31 * 86_400_000))).resolves.toEqual(invalid);

    await revokeApiToken({ tokenId: token.id }, prisma);
    await expect(authenticateApiRequest(call(value), prisma, now)).resolves.toEqual(invalid);
  });

  it("refuses writes with a read-only token (CA-API-04)", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    await signedIn(owner);
    const { value } = await createApiToken({ name: "Leitura", scope: "READ", validityDays: 30 }, prisma);

    await expect(authenticateApiRequest(call(value, "POST"), prisma, now)).resolves.toEqual({ ok: false, error: "insufficient_scope" });
    await expect(authenticateApiRequest(call(value, "GET"), prisma, now)).resolves.toMatchObject({ ok: true });
  });

  it("counts 60 calls a minute per token, even concurrent ones, without affecting other tokens (CA-API-08)", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    await signedIn(owner);
    const busy = await createApiToken({ name: "Muito usado", scope: "READ", validityDays: 30 }, prisma);
    const quiet = await createApiToken({ name: "Outro", scope: "READ", validityDays: 30 }, prisma);
    const minute = new Date("2026-11-02T15:00:10.000Z");

    const results = await Promise.all(
      Array.from({ length: API_CALLS_PER_MINUTE + 1 }, () => authenticateApiRequest(call(busy.value), prisma, minute)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(API_CALLS_PER_MINUTE);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "rate_limited", retryAfterSeconds: 50 }]);

    await expect(authenticateApiRequest(call(quiet.value), prisma, minute)).resolves.toMatchObject({ ok: true });
    await expect(authenticateApiRequest(call(busy.value), prisma, new Date("2026-11-02T15:01:00.000Z"))).resolves.toMatchObject({ ok: true });
  });

  it("makes the token owner the user of the use cases only inside the call", async () => {
    const user = { id: "u1", name: "Ana", email: "ana@exemplo.test", role: "REQUESTER" as const, sectorId: null, isActive: true as const };

    await expect(runAsApiUser(user, () => getCurrentUser())).resolves.toEqual(user);
    await expect(
      Promise.all([
        runAsApiUser(user, async () => (await getCurrentUser())?.id),
        runAsApiUser({ ...user, id: "u2" }, async () => (await getCurrentUser())?.id),
      ]),
    ).resolves.toEqual(["u1", "u2"]);
  });
});
