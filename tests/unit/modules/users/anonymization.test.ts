import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  AnonymizationTarget,
  AnonymizationTransaction,
} from "@/modules/users/application/ports";
import {
  ANONYMIZED_CONTENT,
  REMOVED_ATTACHMENT_NAME,
  UNUSABLE_PASSWORD_HASH,
  anonymizationCode,
  anonymizedIdentity,
  assertCanAnonymize,
} from "@/modules/users/domain/anonymization";
import { verifyPassword } from "@/modules/auth/infrastructure/argon2-password";
import { createRollbackRunner, testNow } from "../../support/in-memory-transaction";

// SPEC 2026-11-02-auditoria-lgpd, 5.5 (SF-107; CA-AUD-07 and CA-AUD-08).

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { anonymizeUser } from "@/modules/users/application/anonymize-user";

const adminId = "11111111-1111-4111-8111-111111111111";
const personId = "22222222-2222-4222-8222-2222abcdef12";

describe("anonymization rules (5.5.1)", () => {
  const target = (overrides: Partial<AnonymizationTarget> = {}): AnonymizationTarget => ({
    id: personId,
    role: "REQUESTER",
    isActive: false,
    anonymizedAt: null,
    ...overrides,
  });
  const check = (overrides: Partial<AnonymizationTarget> = {}, ongoingRequestCount = 0, actorId = adminId) =>
    () => assertCanAnonymize({ actorId, target: target(overrides), activeAdministratorCount: 1, ongoingRequestCount });

  it("accepts a deactivated person without requests in progress", () => {
    expect(check()).not.toThrow();
    expect(check({ role: "ADMIN" })).not.toThrow();
  });

  it("refuses active people, oneself, people already anonymized and requests in progress", () => {
    expect(check({ isActive: true })).toThrow(ConflictError);
    expect(check({ id: adminId, role: "ADMIN" }, 0, adminId)).toThrow(ConflictError);
    expect(check({ anonymizedAt: testNow })).toThrow(ConflictError);
    expect(check({}, 1)).toThrow(ConflictError);
  });

  it("refuses the last active administrator", () => {
    expect(check({ role: "ADMIN", isActive: true })).toThrow(ConflictError);
  });

  it("builds the new identity from the random part of the id only", () => {
    expect(anonymizationCode(personId)).toBe("2222abcdef12");
    expect(anonymizedIdentity(personId)).toEqual({
      name: "Pessoa anonimizada 2222abcdef12",
      email: "anonimizado-2222abcdef12@anonimizado.invalid",
    });
  });

  it("stores a password hash that never authenticates (CA-AUD-08)", async () => {
    await expect(verifyPassword(UNUSABLE_PASSWORD_HASH, "")).resolves.toBe(false);
    await expect(verifyPassword(UNUSABLE_PASSWORD_HASH, UNUSABLE_PASSWORD_HASH)).resolves.toBe(false);
  });
});

interface Store {
  user: AnonymizationTarget & { name: string; email: string; passwordHash: string };
  ongoingRequests: number;
  activeAdministrators: number;
  texts: Record<string, string>;
  notifications: number;
  permissions: string[];
  permissionEvents: Array<{ permission: string; action: string; actorId: string }>;
  attachments: Array<{ storageKey: string; filename: string; removedAt: Date | null }>;
  auditLabels: string[];
  auditEntries: Array<{ action: string; entityId?: string }>;
}

function seed(overrides: Partial<Store["user"]> = {}): Store {
  return {
    user: {
      id: personId,
      name: "Carla Mendes",
      email: "carla@exemplo.test",
      passwordHash: "$argon2id$carla",
      role: "REQUESTER",
      isActive: false,
      anonymizedAt: null,
      ...overrides,
    },
    ongoingRequests: 0,
    activeAdministrators: 1,
    texts: { description: "A tomada da sala 12 não funciona.", comment: "Obrigada, Diego." },
    notifications: 3,
    permissions: ["SECTOR_SERVICES"],
    permissionEvents: [],
    attachments: [{ storageKey: `requests/r/${personId}`, filename: "rg-carla.pdf", removedAt: null }],
    auditLabels: ["Carla Mendes"],
    auditEntries: [],
  };
}

function transaction(store: Store): AnonymizationTransaction {
  return {
    async audited(meta, change) {
      const result = await change();
      store.auditEntries.push({ action: meta.action, entityId: meta.entityId });
      return result;
    },
    async currentTime() {
      return testNow;
    },
    async findTarget(id) {
      return id === store.user.id ? { ...store.user } : null;
    },
    async countActiveAdministrators() {
      return store.activeAdministrators;
    },
    async countOngoingRequests() {
      return store.ongoingRequests;
    },
    async replaceIdentity(_id, identity) {
      Object.assign(store.user, identity);
    },
    async replaceWrittenContent(_id, replacement) {
      for (const key of Object.keys(store.texts)) store.texts[key] = replacement;
    },
    async deleteNotificationData() {
      store.notifications = 0;
    },
    async revokePermissions(_id, actorId) {
      for (const permission of store.permissions) store.permissionEvents.push({ permission, action: "REVOKED", actorId });
      store.permissions = [];
    },
    async markAttachmentsRemoved(_id, filename, removedAt) {
      const keys = store.attachments.filter((item) => item.removedAt === null).map((item) => item.storageKey);
      for (const item of store.attachments) Object.assign(item, { filename, removedAt });
      return keys;
    },
    async relabelAuditEntries(_id, label) {
      store.auditLabels = store.auditLabels.map(() => label);
    },
  };
}

const confirmed = { userId: personId, confirmed: true };

describe("anonymizeUser (5.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: adminId, role: "ADMIN" });
  });

  it("replaces identity and content, deletes notifications, revokes permissions and removes files (CA-AUD-08)", async () => {
    const store = seed();
    const files = { remove: vi.fn(async () => {}) };

    const result = await anonymizeUser(confirmed, { transactions: createRollbackRunner(store, transaction), files });

    expect(result).toEqual({ id: personId, name: "Pessoa anonimizada 2222abcdef12" });
    expect(store.user).toMatchObject({
      name: "Pessoa anonimizada 2222abcdef12",
      email: "anonimizado-2222abcdef12@anonimizado.invalid",
      passwordHash: UNUSABLE_PASSWORD_HASH,
      anonymizedAt: testNow,
    });
    expect(Object.values(store.texts)).toEqual([ANONYMIZED_CONTENT, ANONYMIZED_CONTENT]);
    expect(store.notifications).toBe(0);
    expect(store.permissions).toEqual([]);
    expect(store.permissionEvents).toEqual([{ permission: "SECTOR_SERVICES", action: "REVOKED", actorId: adminId }]);
    expect(store.attachments).toEqual([{ storageKey: `requests/r/${personId}`, filename: REMOVED_ATTACHMENT_NAME, removedAt: testNow }]);
    expect(files.remove).toHaveBeenCalledWith(`requests/r/${personId}`);
    expect(store.auditLabels).toEqual(["Pessoa anonimizada 2222abcdef12"]);
    expect(store.auditEntries).toEqual([{ action: "ANONYMIZED", entityId: personId }]);
    expect(JSON.stringify(store)).not.toMatch(/Carla|carla@|rg-carla|Diego|tomada/);
  });

  it("refuses without the explicit confirmation, changing nothing (5.5.2)", async () => {
    const store = seed();
    const files = { remove: vi.fn(async () => {}) };
    const deps = { transactions: createRollbackRunner(store, transaction), files };

    for (const input of [{ userId: personId }, { userId: personId, confirmed: false }, { userId: personId, confirmed: "true" }]) {
      await expect(anonymizeUser(input, deps)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(store.user.name).toBe("Carla Mendes");
    expect(files.remove).not.toHaveBeenCalled();
  });

  it("refuses outside the conditions of 5.5.1 without changing anything (CA-AUD-07)", async () => {
    const cases: Array<[Partial<Store["user"]>, number]> = [
      [{ isActive: true }, 0],
      [{ id: adminId, role: "ADMIN" }, 0],
      [{ anonymizedAt: testNow }, 0],
      [{}, 1],
    ];

    for (const [overrides, ongoingRequests] of cases) {
      const store = { ...seed(overrides), ongoingRequests };
      const before = structuredClone(store);
      const files = { remove: vi.fn(async () => {}) };

      await expect(
        anonymizeUser({ userId: store.user.id, confirmed: true }, { transactions: createRollbackRunner(store, transaction), files }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(store).toEqual(before);
      expect(files.remove).not.toHaveBeenCalled();
    }
  });

  it("answers not found for an unknown person", async () => {
    const store = seed();

    await expect(
      anonymizeUser(
        { userId: "33333333-3333-4333-8333-333333333333", confirmed: true },
        { transactions: createRollbackRunner(store, transaction), files: { remove: vi.fn() } },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rolls everything back when the storage fails, so a retry can finish the job", async () => {
    const store = seed();
    const before = structuredClone(store);
    const failure = new Error("storage down");

    await expect(
      anonymizeUser(confirmed, {
        transactions: createRollbackRunner(store, transaction),
        files: { remove: vi.fn(async () => Promise.reject(failure)) },
      }),
    ).rejects.toBe(failure);
    expect(store).toEqual(before);
  });

  it("is only for the administrator", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    const store = seed();

    await expect(
      anonymizeUser(confirmed, { transactions: createRollbackRunner(store, transaction), files: { remove: vi.fn() } }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(store.user.name).toBe("Carla Mendes");
  });
});
