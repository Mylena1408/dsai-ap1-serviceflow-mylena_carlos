import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  ServiceStageRepository,
  ServiceStageTransaction,
} from "@/modules/service-stages/application/ports";
import type { ServiceStageRecord } from "@/modules/service-stages/domain/service-stage";
import { createRollbackRunner, nextTestId, testNow } from "../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({
  requireConfigurationAdministrator: vi.fn(),
  // Since SPEC 2026-11-01-permissoes-configuraveis the catalog asks for a catalog editor; here
  // it is always the administrator controlled by requireConfigurationAdministrator.
  requireCatalogEditor: vi.fn(async () => ({ actor: await authorization.requireConfigurationAdministrator(), sectorId: null })),
  assertCatalogSector: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import {
  createServiceStage,
  deactivateServiceStage,
  listServiceStages,
  moveServiceStage,
  reactivateServiceStage,
  renameServiceStage,
} from "@/modules/service-stages/application/service-stage-use-cases";

// SPEC 2026-11-01-fluxos-configuraveis, section 5.1 (SF-077; CA-FLX-02 and 03).

interface Store {
  serviceIds: string[];
  stages: ServiceStageRecord[];
}

const serviceId = nextTestId();

function transaction(store: Store): ServiceStageTransaction {
  const find = (id: string) => {
    const found = store.stages.find((item) => item.id === id);
    if (!found) throw new NotFoundError();
    return found;
  };
  return {
    async findServiceSector(id) {
      return store.serviceIds.includes(id) ? "sector-1" : null;
    },
    async listForService(id) {
      return store.stages
        .filter((item) => item.serviceId === id)
        .map(({ id: stageId, position, name, isActive }) => ({ id: stageId, position, name, isActive }));
    },
    async find(id) {
      return store.stages.find((item) => item.id === id) ?? null;
    },
    async create(data) {
      const created: ServiceStageRecord = { id: nextTestId(), isActive: true, createdAt: testNow, updatedAt: testNow, ...data };
      store.stages.push(created);
      return created;
    },
    async update(id, data) {
      return Object.assign(find(id), data);
    },
  };
}

function repository(store: Store): ServiceStageRepository {
  return {
    async listAll() {
      return [...store.stages].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.position - b.position);
    },
    async listForSector() {
      return [...store.stages].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.position - b.position);
    },
  };
}

const runner = (store: Store) => createRollbackRunner(store, transaction);
const emptyStore = (): Store => ({ serviceIds: [serviceId], stages: [] });

async function seedStages(store: Store, names: string[]) {
  const created = [];
  for (const name of names) {
    created.push(await createServiceStage(serviceId, { name }, runner(store)));
  }
  return created;
}

function activeOrder(store: Store): string[] {
  return store.stages
    .filter((stage) => stage.isActive)
    .sort((a, b) => a.position - b.position)
    .map(({ name }) => name);
}

describe("stage configuration use cases (SF-077)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
  });

  it("appends stages in order with trimmed names", async () => {
    const store = emptyStore();
    const [first, second] = await seedStages(store, ["  Triagem  ", "Execução"]);

    expect(first).toMatchObject({ name: "Triagem", position: 0, isActive: true });
    expect(second).toMatchObject({ name: "Execução", position: 1 });
    expect((await listServiceStages(repository(store))).map(({ name }) => name)).toEqual(["Triagem", "Execução"]);
  });

  it("renames active stages, refusing a name used by another active stage (CA-FLX-03)", async () => {
    const store = emptyStore();
    const [triage, execution] = await seedStages(store, ["Triagem", "Execução"]);

    await expect(renameServiceStage(triage.id, { name: "Análise" }, runner(store))).resolves.toMatchObject({
      name: "Análise",
    });
    await expect(renameServiceStage(execution.id, { name: "ANÁLISE" }, runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(renameServiceStage(execution.id, { name: "EXECUÇÃO" }, runner(store))).resolves.toMatchObject({
      name: "EXECUÇÃO",
    });
    await expect(createServiceStage(serviceId, { name: "análise" }, runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("allows eight active stages and refuses the ninth (CA-FLX-03)", async () => {
    const store = emptyStore();
    await seedStages(store, Array.from({ length: 8 }, (_, index) => `Etapa ${index + 1}`));

    await expect(createServiceStage(serviceId, { name: "Etapa 9" }, runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(store.stages).toHaveLength(8);
  });

  it("refuses invalid names and unknown services without writing", async () => {
    const store = emptyStore();

    for (const input of [{ name: "" }, { name: "a".repeat(61) }, { name: "Ok", position: 3 }, {}]) {
      await expect(createServiceStage(serviceId, input, runner(store))).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(createServiceStage(nextTestId(), { name: "X" }, runner(store))).rejects.toBeInstanceOf(NotFoundError);
    await expect(createServiceStage("not-a-uuid", { name: "X" }, runner(store))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(store.stages).toHaveLength(0);
  });

  it("moves active stages and ignores moves past the ends", async () => {
    const store = emptyStore();
    const [first, , third] = await seedStages(store, ["A", "B", "C"]);

    await moveServiceStage(third.id, "up", runner(store));
    expect(activeOrder(store)).toEqual(["A", "C", "B"]);
    await moveServiceStage(first.id, "up", runner(store));
    expect(activeOrder(store)).toEqual(["A", "C", "B"]);
    await expect(moveServiceStage(first.id, "left", runner(store))).rejects.toBeInstanceOf(ValidationError);
  });

  it("deactivates once and keeps inactive stages out of renames and moves", async () => {
    const store = emptyStore();
    const [stage] = await seedStages(store, ["A", "B"]);

    await expect(deactivateServiceStage(stage.id, runner(store))).resolves.toMatchObject({ isActive: false });
    await expect(deactivateServiceStage(stage.id, runner(store))).resolves.toMatchObject({ isActive: false });
    await expect(renameServiceStage(stage.id, { name: "A2" }, runner(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(moveServiceStage(stage.id, "down", runner(store))).rejects.toBeInstanceOf(ConflictError);
    expect(activeOrder(store)).toEqual(["B"]);
  });

  it("reactivates at the end of the flow, within the limit and without repeating names", async () => {
    const store = emptyStore();
    const [first] = await seedStages(store, ["A", "B"]);
    await deactivateServiceStage(first.id, runner(store));

    await expect(reactivateServiceStage(first.id, runner(store))).resolves.toMatchObject({ isActive: true, position: 2 });
    expect(activeOrder(store)).toEqual(["B", "A"]);
    await expect(reactivateServiceStage(first.id, runner(store))).resolves.toMatchObject({ isActive: true });

    await deactivateServiceStage(first.id, runner(store));
    await createServiceStage(serviceId, { name: "a" }, runner(store));
    await expect(reactivateServiceStage(first.id, runner(store))).rejects.toBeInstanceOf(ConflictError);

    const full = emptyStore();
    const [spare] = await seedStages(full, ["Reserva"]);
    await deactivateServiceStage(spare.id, runner(full));
    await seedStages(full, Array.from({ length: 8 }, (_, index) => `Etapa ${index + 1}`));
    await expect(reactivateServiceStage(spare.id, runner(full))).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses unknown stages and every operation without an administrator (CA-FLX-02)", async () => {
    const store = emptyStore();
    const [stage] = await seedStages(store, ["A"]);

    await expect(renameServiceStage(nextTestId(), { name: "X" }, runner(store))).rejects.toBeInstanceOf(NotFoundError);
    await expect(reactivateServiceStage(nextTestId(), runner(store))).rejects.toBeInstanceOf(NotFoundError);

    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    await expect(listServiceStages(repository(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createServiceStage(serviceId, { name: "B" }, runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(renameServiceStage(stage.id, { name: "B" }, runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(moveServiceStage(stage.id, "down", runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(deactivateServiceStage(stage.id, runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(reactivateServiceStage(stage.id, runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    expect(store.stages).toMatchObject([{ name: "A", isActive: true }]);
  });
});
