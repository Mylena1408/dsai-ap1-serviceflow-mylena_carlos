import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  DocumentRequirementRepository,
  DocumentRequirementTransaction,
} from "@/modules/document-requirements/application/ports";
import type { DocumentRequirementRecord } from "@/modules/document-requirements/domain/document-requirement";
import { createRollbackRunner, nextTestId, testNow } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({
  requireConfigurationAdministrator: vi.fn(),
  // Since SPEC 2026-11-01-permissoes-configuraveis the catalog asks for a catalog editor; here
  // it is always the administrator controlled by requireConfigurationAdministrator.
  requireCatalogEditor: vi.fn(async () => ({ actor: await authorization.requireConfigurationAdministrator(), sectorId: null })),
  assertCatalogSector: vi.fn(),
  requirePublishedCatalogReader: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import {
  createDocumentRequirement,
  deactivateDocumentRequirement,
  listDocumentRequirements,
  listPublishedServiceRequirements,
  moveDocumentRequirement,
  updateDocumentRequirement,
} from "@/modules/document-requirements/application/document-requirement-use-cases";

interface Store {
  serviceIds: string[];
  requirements: DocumentRequirementRecord[];
}

const serviceId = nextTestId();

function transaction(store: Store): DocumentRequirementTransaction {
  const find = (id: string) => {
    const found = store.requirements.find((item) => item.id === id);
    if (!found) throw new NotFoundError();
    return found;
  };
  return {
    async findServiceSector(id) {
      return store.serviceIds.includes(id) ? "sector-1" : null;
    },
    async listForService(id) {
      return store.requirements
        .filter((item) => item.serviceId === id)
        .map(({ id: requirementId, position, isActive }) => ({ id: requirementId, position, isActive }));
    },
    async listActiveForService(id) {
      return store.requirements
        .filter((item) => item.serviceId === id && item.isActive)
        .map(({ id: requirementId, position }) => ({ id: requirementId, position }));
    },
    async find(id) {
      return store.requirements.find((item) => item.id === id) ?? null;
    },
    async create(data) {
      const created: DocumentRequirementRecord = {
        id: nextTestId(),
        isActive: true,
        createdAt: testNow,
        updatedAt: testNow,
        ...data,
      };
      store.requirements.push(created);
      return created;
    },
    async update(id, data) {
      return Object.assign(find(id), data);
    },
  };
}

function repository(store: Store): DocumentRequirementRepository {
  return {
    async listAll() {
      return [...store.requirements].sort((a, b) => a.position - b.position);
    },
    async listForSector() {
      return [...store.requirements].sort((a, b) => a.position - b.position);
    },
    async listActiveForService(id) {
      return store.requirements
        .filter((item) => item.serviceId === id && item.isActive)
        .sort((a, b) => a.position - b.position);
    },
  };
}

const runner = (store: Store) => createRollbackRunner(store, transaction);
const input = (name: string) => ({ name, isRequired: true, acceptedFormats: ["PDF"] });

async function seedRequirements(store: Store, names: string[]) {
  const created = [];
  for (const name of names) {
    created.push(await createDocumentRequirement(serviceId, input(name), runner(store)));
  }
  return created;
}

describe("document requirement use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
  });

  it("appends requirements in order and edits active ones", async () => {
    const store: Store = { serviceIds: [serviceId], requirements: [] };
    const [first, second] = await seedRequirements(store, ["ID card", "Proof of address"]);

    expect([first.position, second.position]).toEqual([0, 1]);
    const edited = await updateDocumentRequirement(
      first.id,
      { name: "Identity card", isRequired: false, acceptedFormats: ["PDF", "TXT"] },
      runner(store),
    );
    expect(edited).toMatchObject({ name: "Identity card", isRequired: false });
    expect((await listDocumentRequirements(repository(store))).map(({ name }) => name)).toEqual([
      "Identity card",
      "Proof of address",
    ]);
  });

  it("enforces the active limit and rejects unknown services and invalid input", async () => {
    const store: Store = { serviceIds: [serviceId], requirements: [] };
    await seedRequirements(store, ["A", "B", "C", "D", "E"]);

    await expect(createDocumentRequirement(serviceId, input("F"), runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      createDocumentRequirement(nextTestId(), input("X"), runner(store)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createDocumentRequirement(serviceId, { name: "", isRequired: true, acceptedFormats: [] }, runner(store)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.requirements).toHaveLength(5);
  });

  it("moves requirements and ignores moves past the edges", async () => {
    const store: Store = { serviceIds: [serviceId], requirements: [] };
    const [first, second] = await seedRequirements(store, ["First", "Second"]);

    await moveDocumentRequirement(second.id, "up", runner(store));
    expect(store.requirements.map(({ name, position }) => [name, position])).toEqual([
      ["First", 1],
      ["Second", 0],
    ]);

    await moveDocumentRequirement(second.id, "up", runner(store));
    expect(store.requirements.find(({ id }) => id === first.id)?.position).toBe(1);
  });

  it("keeps deactivated requirements as read-only history", async () => {
    const store: Store = { serviceIds: [serviceId], requirements: [] };
    const [requirement] = await seedRequirements(store, ["Old"]);

    expect((await deactivateDocumentRequirement(requirement.id, runner(store))).isActive).toBe(false);
    await expect(deactivateDocumentRequirement(requirement.id, runner(store))).resolves.toMatchObject({
      isActive: false,
    });
    await expect(
      updateDocumentRequirement(requirement.id, input("New"), runner(store)),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(moveDocumentRequirement(requirement.id, "down", runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("shows requesters only the active requirements of the requested service", async () => {
    const otherServiceId = nextTestId();
    const store: Store = { serviceIds: [serviceId, otherServiceId], requirements: [] };
    const [first, second] = await seedRequirements(store, ["ID card", "Proof of address"]);
    await createDocumentRequirement(otherServiceId, input("Other service file"), runner(store));
    await deactivateDocumentRequirement(first.id, runner(store));
    authorization.requirePublishedCatalogReader.mockResolvedValue({ id: "requester" });

    const listed = await listPublishedServiceRequirements(serviceId, repository(store));

    expect(listed.map(({ id }) => id)).toEqual([second.id]);
    expect(authorization.requirePublishedCatalogReader).toHaveBeenCalledOnce();
  });

  it("checks the requester before listing and rejects malformed service ids", async () => {
    const store: Store = { serviceIds: [serviceId], requirements: [] };
    authorization.requirePublishedCatalogReader.mockRejectedValueOnce(new NotFoundError());
    await expect(listPublishedServiceRequirements(serviceId, repository(store))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    authorization.requirePublishedCatalogReader.mockResolvedValue({ id: "requester" });
    await expect(listPublishedServiceRequirements("not-an-id", repository(store))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
