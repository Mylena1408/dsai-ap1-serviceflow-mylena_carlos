import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  ConflictError,
  ValidationError,
} from "@/server/errors";
import type {
  AdministratorBootstrapStore,
  AdministratorBootstrapTransaction,
  AuthUserRepository,
  CredentialUser,
  PasswordHasher,
} from "@/modules/auth/application/ports";
import { createRollbackRunner, nextTestId } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { authenticateCredentials } from "@/modules/auth/application/authenticate-credentials";
import {
  changeOwnPassword,
  CurrentPasswordMismatchError,
} from "@/modules/auth/application/change-own-password";
import { bootstrapFirstAdmin } from "@/modules/auth/application/bootstrap-admin";

type StoredUser = CredentialUser & { role: "ADMIN" | "REQUESTER" | "ATTENDANT" };

const passwords: PasswordHasher = {
  hash: async (password) => `hash:${password}`,
  verify: async (passwordHash, password) => passwordHash === `hash:${password}`,
};

function storedUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: nextTestId(),
    name: "Ana",
    email: "ana@example.test",
    passwordHash: "hash:current-password",
    isActive: true,
    role: "REQUESTER",
    ...overrides,
  };
}

function repository(users: StoredUser[]): AuthUserRepository {
  return {
    async findCredentialUserByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findSessionUser(id) {
      const user = users.find((item) => item.id === id);
      return user ? { ...user, sectorId: null } : null;
    },
    async findPasswordState(id) {
      const user = users.find((item) => item.id === id);
      return user ? { passwordHash: user.passwordHash, isActive: user.isActive } : null;
    },
    async replacePasswordHash({ userId, expectedHash, newHash }) {
      const user = users.find(
        (item) => item.id === userId && item.passwordHash === expectedHash && item.isActive,
      );
      if (!user) return 0;
      user.passwordHash = newHash;
      return 1;
    },
  };
}

function bootstrapStore(users: StoredUser[]): AdministratorBootstrapStore {
  const store = { users };
  const countAdministrators = async () => store.users.filter((user) => user.role === "ADMIN").length;
  const runner = createRollbackRunner(store, (state): AdministratorBootstrapTransaction => ({
    countAdministrators,
    async createAdministrator({ name, email, passwordHash }) {
      const created = storedUser({ name, email, passwordHash, role: "ADMIN" });
      state.users.push(created);
      return { id: created.id, name, email };
    },
  }));
  return { countAdministrators, run: runner.run };
}

describe("authenticateCredentials", () => {
  it("returns the public identity for a valid active user", async () => {
    const user = storedUser();

    await expect(
      authenticateCredentials(
        { email: " ANA@example.test ", password: "current-password" },
        repository([user]),
        passwords,
      ),
    ).resolves.toEqual({ id: user.id, name: "Ana", email: "ana@example.test" });
  });

  it("rejects wrong passwords, inactive users and malformed input without details", async () => {
    const users = [storedUser(), storedUser({ email: "off@example.test", isActive: false })];

    for (const input of [
      { email: "ana@example.test", password: "wrong" },
      { email: "off@example.test", password: "current-password" },
      { email: "ana@example.test" },
      { email: "ana@example.test", password: "current-password", role: "ADMIN" },
    ]) {
      await expect(authenticateCredentials(input, repository(users), passwords)).resolves.toBeNull();
    }
  });
});

describe("changeOwnPassword", () => {
  const input = {
    currentPassword: "current-password",
    newPassword: "a-new-long-password",
    confirmPassword: "a-new-long-password",
  };

  beforeEach(() => vi.clearAllMocks());

  it("replaces the hash of the session user after verifying the current password", async () => {
    const user = storedUser();
    authorization.requireCurrentActor.mockResolvedValue({ id: user.id });

    await changeOwnPassword(input, repository([user]), passwords);

    expect(user.passwordHash).toBe("hash:a-new-long-password");
  });

  it("keeps the hash when the current password is wrong or the input is invalid", async () => {
    const user = storedUser();
    authorization.requireCurrentActor.mockResolvedValue({ id: user.id });

    await expect(
      changeOwnPassword({ ...input, currentPassword: "wrong" }, repository([user]), passwords),
    ).rejects.toBeInstanceOf(CurrentPasswordMismatchError);
    await expect(
      changeOwnPassword({ ...input, confirmPassword: "different" }, repository([user]), passwords),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(user.passwordHash).toBe("hash:current-password");
  });

  it("rejects inactive accounts and concurrent changes", async () => {
    const inactive = storedUser({ isActive: false });
    authorization.requireCurrentActor.mockResolvedValue({ id: inactive.id });
    await expect(changeOwnPassword(input, repository([inactive]), passwords)).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    const user = storedUser();
    authorization.requireCurrentActor.mockResolvedValue({ id: user.id });
    const racing = { ...repository([user]), replacePasswordHash: async () => 0 };
    await expect(changeOwnPassword(input, racing, passwords)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("bootstrapFirstAdmin", () => {
  const admin = { name: "First admin", email: "admin@example.test", password: "admin-password" };

  it("creates the first administrator with a hashed password", async () => {
    const users: StoredUser[] = [];

    await expect(bootstrapFirstAdmin(admin, bootstrapStore(users), passwords)).resolves.toMatchObject({
      name: "First admin",
      email: "admin@example.test",
    });
    expect(users).toEqual([
      expect.objectContaining({ role: "ADMIN", passwordHash: "hash:admin-password" }),
    ]);
  });

  it("refuses when an administrator exists or the input is invalid", async () => {
    const users = [storedUser({ role: "ADMIN" })];

    await expect(bootstrapFirstAdmin(admin, bootstrapStore(users), passwords)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      bootstrapFirstAdmin({ ...admin, role: "ADMIN" }, bootstrapStore([]), passwords),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(users).toHaveLength(1);
  });
});
