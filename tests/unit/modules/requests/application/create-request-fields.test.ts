import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";
import { createMemoryDocumentStorage } from "@/server/storage";
import { FieldAnswersError } from "@/modules/service-fields";
import {
  activeService,
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  serviceId,
  type InMemoryRequestStore,
  type StoredActor,
  type StoredField,
} from "../in-memory-requests";
import { minimalPdf } from "../../attachments/synthetic-files";

const authorization = vi.hoisted(() => ({ requireRequestCreator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { createRequest } from "@/modules/requests/application/create-request";

// SPEC 2026-11-01-campos-personalizados, sections 5.3 and 5.4 (SF-073).

const requester: StoredActor = {
  id: "requester-1",
  role: "REQUESTER",
  sectorId: null,
  isActive: true,
  name: "Requester",
  email: "requester@example.test",
};
const assetId = "55555555-5555-4555-8555-555555555551";
const shiftId = "55555555-5555-4555-8555-555555555552";
const dateId = "55555555-5555-4555-8555-555555555553";
const inactiveId = "55555555-5555-4555-8555-555555555554";
const foreignId = "55555555-5555-4555-8555-555555555555";
const requirementId = "33333333-3333-4333-8333-333333333331";

function field(overrides: Partial<StoredField> & Pick<StoredField, "id" | "label" | "position">): StoredField {
  return {
    serviceId,
    type: "SHORT_TEXT",
    isRequired: false,
    options: [],
    minValue: null,
    maxValue: null,
    isActive: true,
    ...overrides,
  };
}

function fields(): StoredField[] {
  return [
    field({ id: shiftId, label: "Turno", type: "SELECT", options: ["Manhã", "Tarde"], isRequired: true, position: 4 }),
    field({ id: assetId, label: "Patrimônio", isRequired: true, position: 1 }),
    field({ id: dateId, label: "Data desejada", type: "DATE", position: 7 }),
    field({ id: inactiveId, label: "Antigo", position: 2, isActive: false }),
    field({ id: foreignId, label: "Outro serviço", position: 0, serviceId: "44444444-4444-4444-8444-444444444444" }),
  ];
}

function storeWithFields(overrides: Partial<InMemoryRequestStore> = {}) {
  return createStore({ actors: [requester], services: [activeService()], fields: fields(), ...overrides });
}

function expectNothingPersisted(store: InMemoryRequestStore) {
  expect(store.requests).toHaveLength(0);
  expect(store.events).toHaveLength(0);
  expect(store.outbox).toHaveLength(0);
  expect(store.fieldValues).toHaveLength(0);
}

async function refusal(promise: Promise<unknown>): Promise<FieldAnswersError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FieldAnswersError);
  return error as FieldAnswersError;
}

describe("createRequest with custom fields (SF-073)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireRequestCreator.mockResolvedValue(requester);
  });

  it("stores normalized answers with the snapshot in the configured order (CA-FLD-08)", async () => {
    const store = storeWithFields();

    const created = await createRequest(
      {
        serviceId,
        description: "Troca de lâmpada",
        fieldValues: { [shiftId]: "Tarde", [assetId]: "  PAT-0042 ", [dateId]: "" },
      },
      createInMemoryTransactionRunner(store),
    );

    expect(store.fieldValues).toEqual([
      {
        requestId: created.id,
        fieldId: assetId,
        labelSnapshot: "Patrimônio",
        typeSnapshot: "SHORT_TEXT",
        positionSnapshot: 0,
        value: "PAT-0042",
        createdAt: fixedNow,
      },
      {
        requestId: created.id,
        fieldId: shiftId,
        labelSnapshot: "Turno",
        typeSnapshot: "SELECT",
        positionSnapshot: 1,
        value: "Tarde",
        createdAt: fixedNow,
      },
    ]);
  });

  it("opens services without fields exactly as before (CA-FLD-01)", async () => {
    const store = createStore({ actors: [requester], services: [activeService()] });

    await createRequest({ serviceId, description: "Sem campos" }, createInMemoryTransactionRunner(store));

    expect(store.requests).toHaveLength(1);
    expect(store.fieldValues).toHaveLength(0);
  });

  it("refuses missing required and invalid answers, reporting each field, without writing (CA-FLD-06, 07)", async () => {
    const store = storeWithFields();

    const error = await refusal(
      createRequest(
        { serviceId, description: "x", fieldValues: { [shiftId]: "Noite", [dateId]: "2026-02-30" } },
        createInMemoryTransactionRunner(store),
      ),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.reason).toBe("invalid");
    expect(error.fieldErrors).toEqual([
      { fieldId: assetId, code: "required" },
      { fieldId: shiftId, code: "invalid_option" },
      { fieldId: dateId, code: "invalid_date" },
    ]);
    expectNothingPersisted(store);
  });

  it("refuses answers to inactive, foreign or unknown fields as an out-of-date form (CA-FLD-06)", async () => {
    for (const fieldId of [inactiveId, foreignId, "not-a-field"]) {
      const store = storeWithFields();
      const error = await refusal(
        createRequest(
          { serviceId, description: "x", fieldValues: { [assetId]: "1", [shiftId]: "Manhã", [fieldId]: "y" } },
          createInMemoryTransactionRunner(store),
        ),
      );

      expect(error.reason).toBe("stale_form");
      expectNothingPersisted(store);
    }
  });

  it("uses the configuration in force when the form arrives (5.3.3)", async () => {
    const store = storeWithFields();
    store.fields.find(({ id }) => id === assetId)!.isActive = false;

    const error = await refusal(
      createRequest(
        { serviceId, description: "x", fieldValues: { [assetId]: "1", [shiftId]: "Manhã" } },
        createInMemoryTransactionRunner(store),
      ),
    );

    expect(error.reason).toBe("stale_form");
  });

  it("checks the answers before storing any file", async () => {
    const store = storeWithFields({
      requirements: [
        { id: requirementId, serviceId, name: "Form", isRequired: false, acceptedFormats: ["PDF"], isActive: true },
      ],
    });
    const storage = createMemoryDocumentStorage();

    await refusal(
      createRequest(
        {
          serviceId,
          description: "x",
          attachments: [{ requirementId, name: "form.pdf", bytes: minimalPdf() }],
          fieldValues: { [shiftId]: "Manhã" },
        },
        createInMemoryTransactionRunner(store),
        storage,
      ),
    );

    expect(storage.size).toBe(0);
    expectNothingPersisted(store);
    expect(store.attachments).toHaveLength(0);
  });

  it("stores answers together with the attachments when both are valid", async () => {
    const store = storeWithFields({
      requirements: [
        { id: requirementId, serviceId, name: "Form", isRequired: true, acceptedFormats: ["PDF"], isActive: true },
      ],
    });

    await createRequest(
      {
        serviceId,
        description: "x",
        attachments: [{ requirementId, name: "form.pdf", bytes: minimalPdf() }],
        fieldValues: { [assetId]: "PAT-1", [shiftId]: "Manhã" },
      },
      createInMemoryTransactionRunner(store),
      createMemoryDocumentStorage(),
    );

    expect(store.attachments).toHaveLength(1);
    expect(store.fieldValues.map(({ value }) => value)).toEqual(["PAT-1", "Manhã"]);
  });

  it("bounds the submitted answers before looking at them", async () => {
    const store = storeWithFields();
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, "v"]));

    await expect(
      createRequest({ serviceId, description: "x", fieldValues: tooMany }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createRequest(
        { serviceId, description: "x", fieldValues: { [assetId]: "a".repeat(20_001) } },
        createInMemoryTransactionRunner(store),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expectNothingPersisted(store);
  });
});
