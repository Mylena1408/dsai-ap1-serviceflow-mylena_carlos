import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type {
  ServiceFieldRepository,
  ServiceFieldTransaction,
} from "@/modules/service-fields/application/ports";
import type { ServiceFieldRecord } from "@/modules/service-fields/domain/service-field";
import { createRollbackRunner, nextTestId, testNow } from "../../../support/in-memory-transaction";

const authorization = vi.hoisted(() => ({
  requireConfigurationAdministrator: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import {
  createServiceField,
  deactivateServiceField,
  listServiceFields,
  moveServiceField,
  reactivateServiceField,
  updateServiceField,
} from "@/modules/service-fields/application/service-field-use-cases";

// SPEC 2026-11-01-campos-personalizados, section 5.1 (SF-072; CA-FLD-02 and 03).

interface Store {
  serviceIds: string[];
  fields: ServiceFieldRecord[];
}

const serviceId = nextTestId();

function transaction(store: Store): ServiceFieldTransaction {
  const find = (id: string) => {
    const found = store.fields.find((item) => item.id === id);
    if (!found) throw new NotFoundError();
    return found;
  };
  return {
    async serviceExists(id) {
      return store.serviceIds.includes(id);
    },
    async listForService(id) {
      return store.fields
        .filter((item) => item.serviceId === id)
        .map(({ id: fieldId, position, label, isActive }) => ({ id: fieldId, position, label, isActive }));
    },
    async find(id) {
      return store.fields.find((item) => item.id === id) ?? null;
    },
    async create(data) {
      const created: ServiceFieldRecord = { id: nextTestId(), isActive: true, createdAt: testNow, updatedAt: testNow, ...data };
      store.fields.push(created);
      return created;
    },
    async update(id, data) {
      return Object.assign(find(id), data);
    },
  };
}

function repository(store: Store): ServiceFieldRepository {
  return {
    async listAll() {
      return [...store.fields].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.position - b.position);
    },
    async listActiveForService(id) {
      return store.fields.filter((item) => item.serviceId === id && item.isActive).sort((a, b) => a.position - b.position);
    },
  };
}

const runner = (store: Store) => createRollbackRunner(store, transaction);

function input(label: string, overrides: Record<string, unknown> = {}) {
  return {
    label,
    helpText: null,
    type: "SHORT_TEXT",
    isRequired: true,
    options: [],
    minValue: null,
    maxValue: null,
    ...overrides,
  };
}

async function seedFields(store: Store, labels: string[]) {
  const created = [];
  for (const label of labels) {
    created.push(await createServiceField(serviceId, input(label), runner(store)));
  }
  return created;
}

const emptyStore = (): Store => ({ serviceIds: [serviceId], fields: [] });

describe("custom field use cases (SF-072)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue({ id: "admin" });
  });

  it("appends fields in order with every type of configuration", async () => {
    const store = emptyStore();
    const text = await createServiceField(serviceId, input("Patrimônio", { helpText: "Etiqueta" }), runner(store));
    const list = await createServiceField(
      serviceId,
      input("Turno", { type: "SELECT", options: ["Manhã", "Tarde"] }),
      runner(store),
    );
    const number = await createServiceField(
      serviceId,
      input("Quantidade", { type: "INTEGER", minValue: 1, maxValue: 50, isRequired: false }),
      runner(store),
    );

    expect([text.position, list.position, number.position]).toEqual([0, 1, 2]);
    expect(list).toMatchObject({ type: "SELECT", options: ["Manhã", "Tarde"], isActive: true });
    expect(number).toMatchObject({ minValue: 1, maxValue: 50, isRequired: false });
    expect((await listServiceFields(repository(store))).map(({ label }) => label)).toEqual([
      "Patrimônio",
      "Turno",
      "Quantidade",
    ]);
  });

  it("edits label, help, obligation and options but never the type", async () => {
    const store = emptyStore();
    const [field] = await seedFields(store, ["Turno antigo"]);
    store.fields[0] = { ...store.fields[0], type: "SELECT", options: ["A", "B"] };

    const edited = await updateServiceField(
      field.id,
      input("Turno", { type: "SELECT", options: ["Manhã", "Tarde", "Noite"], isRequired: false, helpText: "Escolha" }),
      runner(store),
    );

    expect(edited).toMatchObject({
      label: "Turno",
      type: "SELECT",
      options: ["Manhã", "Tarde", "Noite"],
      isRequired: false,
      helpText: "Escolha",
    });
    await expect(updateServiceField(field.id, input("Turno"), runner(store))).rejects.toBeInstanceOf(ConflictError);
    expect(store.fields[0].type).toBe("SELECT");
  });

  it("allows ten active fields and refuses the eleventh (CA-FLD-03)", async () => {
    const store = emptyStore();
    await seedFields(store, Array.from({ length: 10 }, (_, index) => `Campo ${index + 1}`));

    await expect(createServiceField(serviceId, input("Campo 11"), runner(store))).rejects.toBeInstanceOf(ConflictError);
    expect(store.fields).toHaveLength(10);
  });

  it("refuses a label repeated among active fields, ignoring case, but frees it on deactivation", async () => {
    const store = emptyStore();
    const [first, second] = await seedFields(store, ["Patrimônio", "Sala"]);

    await expect(createServiceField(serviceId, input("PATRIMÔNIO"), runner(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(updateServiceField(second.id, input("patrimônio"), runner(store))).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateServiceField(first.id, input("PATRIMÔNIO"), runner(store))).resolves.toMatchObject({
      label: "PATRIMÔNIO",
    });

    await deactivateServiceField(first.id, runner(store));
    await expect(createServiceField(serviceId, input("Patrimônio"), runner(store))).resolves.toMatchObject({
      isActive: true,
    });
  });

  it("refuses invalid input and unknown services without writing", async () => {
    const store = emptyStore();

    await expect(createServiceField(serviceId, input(""), runner(store))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createServiceField(serviceId, input("Turno", { type: "SELECT", options: ["Só uma"] }), runner(store)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createServiceField(serviceId, input("Qtd", { type: "INTEGER", minValue: 5, maxValue: 1 }), runner(store)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createServiceField(nextTestId(), input("X"), runner(store))).rejects.toBeInstanceOf(NotFoundError);
    await expect(createServiceField("not-a-uuid", input("X"), runner(store))).rejects.toBeInstanceOf(ValidationError);
    expect(store.fields).toHaveLength(0);
  });

  it("moves active fields and ignores moves past the edges", async () => {
    const store = emptyStore();
    const [first, second, third] = await seedFields(store, ["A", "B", "C"]);

    await moveServiceField(third.id, "up", runner(store));
    await moveServiceField(first.id, "up", runner(store));
    await moveServiceField(second.id, "down", runner(store));

    const order = [...store.fields].sort((a, b) => a.position - b.position).map(({ label }) => label);
    expect(order).toEqual(["A", "C", "B"]);
    await expect(moveServiceField(first.id, "sideways", runner(store))).rejects.toBeInstanceOf(ValidationError);
  });

  it("deactivates fields once and keeps inactive fields out of edits and moves", async () => {
    const store = emptyStore();
    const [field] = await seedFields(store, ["A", "B"]);

    await expect(deactivateServiceField(field.id, runner(store))).resolves.toMatchObject({ isActive: false });
    await expect(deactivateServiceField(field.id, runner(store))).resolves.toMatchObject({ isActive: false });
    await expect(updateServiceField(field.id, input("A2"), runner(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(moveServiceField(field.id, "down", runner(store))).rejects.toBeInstanceOf(ConflictError);
  });

  it("reactivates at the end of the form, within the limit and without repeating labels (5.1 item 4)", async () => {
    const store = emptyStore();
    const [first] = await seedFields(store, ["A", "B"]);
    await deactivateServiceField(first.id, runner(store));

    await expect(reactivateServiceField(first.id, runner(store))).resolves.toMatchObject({
      isActive: true,
      position: 2,
    });
    await expect(reactivateServiceField(first.id, runner(store))).resolves.toMatchObject({ isActive: true });

    await deactivateServiceField(first.id, runner(store));
    await createServiceField(serviceId, input("a"), runner(store));
    await expect(reactivateServiceField(first.id, runner(store))).rejects.toBeInstanceOf(ConflictError);

    const full = emptyStore();
    const [old] = await seedFields(full, ["Antigo"]);
    await deactivateServiceField(old.id, runner(full));
    await seedFields(full, Array.from({ length: 10 }, (_, index) => `Campo ${index + 1}`));
    await expect(reactivateServiceField(old.id, runner(full))).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses unknown fields and every operation without an administrator (CA-FLD-02)", async () => {
    const store = emptyStore();
    const [field] = await seedFields(store, ["A"]);

    await expect(updateServiceField(nextTestId(), input("X"), runner(store))).rejects.toBeInstanceOf(NotFoundError);
    await expect(reactivateServiceField(nextTestId(), runner(store))).rejects.toBeInstanceOf(NotFoundError);

    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    await expect(listServiceFields(repository(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createServiceField(serviceId, input("B"), runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateServiceField(field.id, input("B"), runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(moveServiceField(field.id, "down", runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(deactivateServiceField(field.id, runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(reactivateServiceField(field.id, runner(store))).rejects.toBeInstanceOf(AuthorizationError);
    expect(store.fields).toHaveLength(1);
    expect(store.fields[0]).toMatchObject({ label: "A", isActive: true });
  });
});
