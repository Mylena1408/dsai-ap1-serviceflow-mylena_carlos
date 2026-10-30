import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  CategoryRepository,
  CategoryTransaction,
} from "@/modules/categories/application/ports";
import type { CategoryRecord } from "@/modules/categories/domain/category";
import { createRollbackRunner, nextTestId, testNow } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  createCategory,
  listCategories,
  setCategoryActive,
  updateCategory,
} from "@/modules/categories/application/category-use-cases";

interface Store {
  categories: CategoryRecord[];
  withActiveService: string[];
}

function category(name: string): CategoryRecord {
  return { id: nextTestId(), name, isActive: true, createdAt: testNow, updatedAt: testNow };
}

function repository(store: Store): CategoryRepository {
  return {
    async listByName() {
      return [...store.categories].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

function transaction(store: Store): CategoryTransaction {
  return {
    async exists(id) {
      return store.categories.some((item) => item.id === id);
    },
    async create(name) {
      const created = category(name);
      store.categories.push(created);
      return created;
    },
    async update(id, data) {
      const found = store.categories.find((item) => item.id === id);
      if (!found) throw new NotFoundError();
      return Object.assign(found, data);
    },
    async hasActiveService(id) {
      return store.withActiveService.includes(id);
    },
  };
}

const runner = (store: Store) => createRollbackRunner(store, transaction);

describe("category use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
  });

  it("creates, lists by name and renames categories", async () => {
    const store: Store = { categories: [category("Hardware")], withActiveService: [] };

    const created = await createCategory({ name: "Access" }, runner(store));
    expect((await listCategories(repository(store))).map(({ name }) => name)).toEqual([
      "Access",
      "Hardware",
    ]);
    expect((await updateCategory(created.id, { name: "Accounts" }, runner(store))).name).toBe(
      "Accounts",
    );
  });

  it("rejects invalid input and unknown categories", async () => {
    const store: Store = { categories: [], withActiveService: [] };

    await expect(createCategory({ name: " " }, runner(store))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      updateCategory(nextTestId(), { name: "Any" }, runner(store)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("blocks deactivation while an active service uses the category", async () => {
    const used = category("Used");
    const free = category("Free");
    const store: Store = { categories: [used, free], withActiveService: [used.id] };

    await expect(setCategoryActive(used.id, false, runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await setCategoryActive(free.id, false, runner(store))).isActive).toBe(false);
  });
});
