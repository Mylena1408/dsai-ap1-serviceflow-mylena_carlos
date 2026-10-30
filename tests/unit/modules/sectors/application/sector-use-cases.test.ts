import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  SectorRepository,
  SectorTransaction,
} from "@/modules/sectors/application/ports";
import type { SectorDeactivationDependencies } from "@/modules/sectors/domain/deactivation";
import type { SectorRecord } from "@/modules/sectors/domain/sector";
import { createRollbackRunner, nextTestId, testNow } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  createSector,
  listSectors,
  setSectorActive,
  updateSector,
} from "@/modules/sectors/application/sector-use-cases";

interface Store {
  sectors: SectorRecord[];
  dependencies: Record<string, SectorDeactivationDependencies>;
}

const noDependencies: SectorDeactivationDependencies = {
  hasActiveService: false,
  hasPendingRequest: false,
  hasActiveAttendant: false,
};

function sector(name: string, overrides: Partial<SectorRecord> = {}): SectorRecord {
  return { id: nextTestId(), name, isActive: true, createdAt: testNow, updatedAt: testNow, ...overrides };
}

function repository(store: Store): SectorRepository {
  return {
    async listByName() {
      return [...store.sectors].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

function transaction(store: Store): SectorTransaction {
  const find = (id: string) => {
    const found = store.sectors.find((item) => item.id === id);
    if (!found) throw new NotFoundError();
    return found;
  };
  return {
    async exists(id) {
      return store.sectors.some((item) => item.id === id);
    },
    async create(name) {
      if (store.sectors.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        throw new ConflictError();
      }
      const created = sector(name);
      store.sectors.push(created);
      return created;
    },
    async update(id, data) {
      return Object.assign(find(id), data);
    },
    async findDeactivationDependencies(id) {
      return store.dependencies[id] ?? noDependencies;
    },
  };
}

const runner = (store: Store) => createRollbackRunner(store, transaction);

describe("sector use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
  });

  it("creates, lists by name and renames sectors", async () => {
    const store: Store = { sectors: [sector("Support")], dependencies: {} };

    const created = await createSector({ name: "Facilities" }, runner(store));
    expect((await listSectors(repository(store))).map(({ name }) => name)).toEqual([
      "Facilities",
      "Support",
    ]);

    const renamed = await updateSector(created.id, { name: "Buildings" }, runner(store));
    expect(renamed.name).toBe("Buildings");
  });

  it("requires an administrator before reading", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new Error("denied"));
    await expect(listSectors(repository({ sectors: [], dependencies: {} }))).rejects.toThrow("denied");
  });

  it("rejects invalid input and unknown sectors", async () => {
    const store: Store = { sectors: [], dependencies: {} };

    await expect(createSector({ name: "" }, runner(store))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateSector(nextTestId(), { name: "Any" }, runner(store)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setSectorActive(nextTestId(), false, runner(store))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("blocks deactivation while dependencies exist and allows it otherwise", async () => {
    const busy = sector("Busy");
    const idle = sector("Idle");
    const store: Store = {
      sectors: [busy, idle],
      dependencies: { [busy.id]: { ...noDependencies, hasPendingRequest: true } },
    };

    await expect(setSectorActive(busy.id, false, runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(busy.isActive).toBe(true);

    expect((await setSectorActive(idle.id, false, runner(store))).isActive).toBe(false);
    expect((await setSectorActive(idle.id, true, runner(store))).isActive).toBe(true);
  });
});
