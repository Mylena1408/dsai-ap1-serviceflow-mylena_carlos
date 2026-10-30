import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  UserRepository,
  UserTransaction,
} from "@/modules/users/application/ports";
import type { ManagedUser } from "@/modules/users/domain/user";
import { createRollbackRunner, nextTestId, testNow } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  createUser,
  listUsers,
  setUserActive,
  updateUser,
} from "@/modules/users/application/user-use-cases";

type StoredUser = ManagedUser & { passwordHash: string };

interface Store {
  users: StoredUser[];
  sectors: Record<string, boolean>;
  pendingRequestsBySector: Record<string, number>;
}

const sectorId = nextTestId();
const inactiveSectorId = nextTestId();

function user(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: nextTestId(),
    name: "User",
    email: `${nextTestId()}@example.test`,
    role: "REQUESTER",
    sectorId: null,
    isActive: true,
    createdAt: testNow,
    updatedAt: testNow,
    passwordHash: "hash:initial",
    ...overrides,
  };
}

const publicView = (stored: StoredUser): ManagedUser => ({
  id: stored.id,
  name: stored.name,
  email: stored.email,
  role: stored.role,
  sectorId: stored.sectorId,
  isActive: stored.isActive,
  createdAt: stored.createdAt,
  updatedAt: stored.updatedAt,
});

function transaction(store: Store): UserTransaction {
  const find = (id: string) => {
    const found = store.users.find((item) => item.id === id);
    if (!found) throw new NotFoundError();
    return found;
  };
  return {
    async findState(id) {
      const found = store.users.find((item) => item.id === id);
      return found
        ? { id: found.id, role: found.role, sectorId: found.sectorId, isActive: found.isActive }
        : null;
    },
    async findSectorActivity(id) {
      return id in store.sectors ? { isActive: store.sectors[id] } : null;
    },
    async countActiveAdministrators() {
      return store.users.filter((item) => item.role === "ADMIN" && item.isActive).length;
    },
    async countPendingRequestsInSector(id) {
      return store.pendingRequestsBySector[id] ?? 0;
    },
    async countOtherActiveAttendants(id, excluded) {
      return store.users.filter(
        (item) => item.id !== excluded && item.role === "ATTENDANT" && item.sectorId === id && item.isActive,
      ).length;
    },
    async create(data) {
      if (store.users.some((item) => item.email === data.email)) throw new ConflictError();
      const created = user(data);
      store.users.push(created);
      return publicView(created);
    },
    async update(id, changes) {
      return publicView(Object.assign(find(id), changes));
    },
  };
}

function seed(users: StoredUser[] = []): Store {
  return { users, sectors: { [sectorId]: true, [inactiveSectorId]: false }, pendingRequestsBySector: {} };
}

const hashPassword = vi.fn(async (password: string) => `hash:${password}`);
const deps = (store: Store) => ({ transactions: createRollbackRunner(store, transaction), hashPassword });
const repository = (store: Store): UserRepository => ({
  async listByName() {
    return store.users.map(publicView).sort((a, b) => a.name.localeCompare(b.name));
  },
});

describe("user use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
  });

  it("creates users with a hashed password and never exposes the hash", async () => {
    const store = seed();

    const created = await createUser(
      { name: "Ana", email: "ana@example.test", password: "secret", role: "ATTENDANT", sectorId },
      deps(store),
    );

    expect(created).toMatchObject({ name: "Ana", role: "ATTENDANT", sectorId });
    expect(created).not.toHaveProperty("passwordHash");
    expect(store.users[0].passwordHash).toBe("hash:secret");
    expect((await listUsers(repository(store))).map(({ name }) => name)).toEqual(["Ana"]);
  });

  it("requires an active sector for attendants", async () => {
    const store = seed();
    const attendant = (sector: string) => ({
      name: "Bia",
      email: "bia@example.test",
      password: "secret",
      role: "ATTENDANT",
      sectorId: sector,
    });

    await expect(createUser(attendant(inactiveSectorId), deps(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(createUser(attendant(nextTestId()), deps(store))).rejects.toBeInstanceOf(NotFoundError);
    expect(store.users).toHaveLength(0);
  });

  it("keeps at least one active administrator", async () => {
    const admin = user({ name: "Admin", role: "ADMIN" });
    const store = seed([admin]);

    await expect(setUserActive(admin.id, false, deps(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateUser(admin.id, { name: "Admin", email: admin.email, role: "REQUESTER", sectorId: null }, deps(store)),
    ).rejects.toBeInstanceOf(ConflictError);

    store.users.push(user({ name: "Second admin", role: "ADMIN" }));
    expect((await setUserActive(admin.id, false, deps(store))).isActive).toBe(false);
  });

  it("blocks the last attendant from leaving a sector with pending requests", async () => {
    const attendant = user({ name: "Caio", role: "ATTENDANT", sectorId });
    const store = seed([attendant]);
    store.pendingRequestsBySector[sectorId] = 1;

    await expect(setUserActive(attendant.id, false, deps(store))).rejects.toBeInstanceOf(ConflictError);

    store.users.push(user({ name: "Dora", role: "ATTENDANT", sectorId }));
    expect((await setUserActive(attendant.id, false, deps(store))).isActive).toBe(false);
  });

  it("hashes a new password only when one is provided", async () => {
    const requester = user({ name: "Eva" });
    const store = seed([requester]);
    const changes = { name: "Eva Lima", email: requester.email, role: "REQUESTER", sectorId: null };

    await updateUser(requester.id, changes, deps(store));
    expect(hashPassword).not.toHaveBeenCalled();
    expect(store.users[0].passwordHash).toBe("hash:initial");

    await updateUser(requester.id, { ...changes, password: "new-secret" }, deps(store));
    expect(store.users[0].passwordHash).toBe("hash:new-secret");
  });

  it("rejects invalid input and unknown users", async () => {
    const store = seed();

    await expect(createUser({ name: "", email: "x" }, deps(store))).rejects.toBeInstanceOf(ValidationError);
    await expect(setUserActive(nextTestId(), true, deps(store))).rejects.toBeInstanceOf(NotFoundError);
  });
});
