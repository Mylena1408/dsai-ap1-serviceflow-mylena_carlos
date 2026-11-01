import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  PublishedCatalogRepository,
  ServiceRepository,
  ServiceTransaction,
} from "@/modules/services/application/ports";
import type { PublishedService, ServiceRecord } from "@/modules/services/domain/service";
import { createRollbackRunner, nextTestId, testNow } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({
  requireConfigurationAdministrator: vi.fn(),
  requirePublishedCatalogReader: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import {
  createService,
  listServices,
  setServiceActive,
  updateService,
} from "@/modules/services/application/service-use-cases";
import {
  getPublishedService,
  listPublishedServices,
} from "@/modules/services/application/catalog-queries";

interface Store {
  services: ServiceRecord[];
  categories: Record<string, { name: string; isActive: boolean }>;
  sectors: Record<string, { name: string; isActive: boolean }>;
}

const categoryId = nextTestId();
const sectorId = nextTestId();
const inactiveSectorId = nextTestId();

function seed(services: ServiceRecord[] = []): Store {
  return {
    services,
    categories: { [categoryId]: { name: "Access", isActive: true } },
    sectors: {
      [sectorId]: { name: "Support", isActive: true },
      [inactiveSectorId]: { name: "Closed", isActive: false },
    },
  };
}

function service(name: string, overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: nextTestId(),
    name,
    description: `${name} description`,
    categoryId,
    sectorId,
    isActive: true,
    defaultPriority: "NORMAL",
    slaHours: null,
    createdAt: testNow,
    updatedAt: testNow,
    ...overrides,
  };
}

function transaction(store: Store): ServiceTransaction {
  const find = (id: string) => {
    const found = store.services.find((item) => item.id === id);
    if (!found) throw new NotFoundError();
    return found;
  };
  return {
    async findState(id) {
      const found = store.services.find((item) => item.id === id);
      return found
        ? { id: found.id, isActive: found.isActive, categoryId: found.categoryId, sectorId: found.sectorId }
        : null;
    },
    async loadRelationships(category, sector) {
      return {
        categoryExists: category in store.categories,
        categoryActive: store.categories[category]?.isActive ?? false,
        sectorExists: sector in store.sectors,
        sectorActive: store.sectors[sector]?.isActive ?? false,
      };
    },
    async create(data) {
      const created = service(data.name, data);
      store.services.push(created);
      return created;
    },
    async update(id, data) {
      return Object.assign(find(id), data);
    },
  };
}

function repository(store: Store): ServiceRepository & PublishedCatalogRepository {
  const published = (item: ServiceRecord): PublishedService => ({
    ...item,
    category: { id: item.categoryId, name: store.categories[item.categoryId].name },
    sector: { id: item.sectorId, name: store.sectors[item.sectorId].name },
  });
  const isPublished = (item: ServiceRecord) =>
    item.isActive &&
    store.categories[item.categoryId]?.isActive &&
    store.sectors[item.sectorId]?.isActive;
  return {
    async listByName() {
      return [...store.services].sort((a, b) => a.name.localeCompare(b.name));
    },
    async listPublished() {
      return store.services.filter(isPublished).map(published);
    },
    async findPublished(id) {
      const found = store.services.find((item) => item.id === id && isPublished(item));
      return found ? published(found) : null;
    },
  };
}

const runner = (store: Store) => createRollbackRunner(store, transaction);
const input = (overrides: Record<string, unknown> = {}) => ({
  name: "Badge",
  description: "Request a badge",
  categoryId,
  sectorId,
  ...overrides,
});

describe("service use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
    authorization.requirePublishedCatalogReader.mockResolvedValue({ id: "reader" });
  });

  it("creates and updates a service with active relationships", async () => {
    const store = seed();

    const created = await createService(input(), runner(store));
    expect(created).toMatchObject({ name: "Badge", categoryId, sectorId, isActive: true });

    const updated = await updateService(created.id, input({ name: "Badge renewal" }), runner(store));
    expect(updated.name).toBe("Badge renewal");
    expect((await listServices(repository(store))).map(({ name }) => name)).toEqual(["Badge renewal"]);
  });

  it("rejects unknown relationships, inactive relationships and invalid input", async () => {
    const store = seed();

    await expect(createService(input({ categoryId: nextTestId() }), runner(store))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(createService(input({ sectorId: inactiveSectorId }), runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(createService(input({ name: "" }), runner(store))).rejects.toBeInstanceOf(ValidationError);
    expect(store.services).toHaveLength(0);
  });

  it("lets an inactive service keep an inactive sector but blocks its reactivation", async () => {
    const dormant = service("Dormant", { isActive: false, sectorId: inactiveSectorId });
    const store = seed([dormant]);

    await expect(
      updateService(dormant.id, input({ name: "Dormant", sectorId: inactiveSectorId }), runner(store)),
    ).resolves.toMatchObject({ name: "Dormant" });
    await expect(setServiceActive(dormant.id, true, runner(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(setServiceActive(nextTestId(), false, runner(store))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("publishes only available services and hides the others", async () => {
    const visible = service("Visible");
    const hidden = service("Hidden", { isActive: false });
    const store = seed([visible, hidden]);

    expect((await listPublishedServices(repository(store))).map(({ name }) => name)).toEqual(["Visible"]);
    await expect(getPublishedService(visible.id, repository(store))).resolves.toMatchObject({
      category: { name: "Access" },
    });
    await expect(getPublishedService(hidden.id, repository(store))).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPublishedService("not-a-uuid", repository(store))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
