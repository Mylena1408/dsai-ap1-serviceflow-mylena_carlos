import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "@/server/errors";
import { createMemoryDocumentStorage, DocumentStorageError } from "@/server/storage";
import { sha256Hex } from "@/modules/attachments";
import {
  activeService,
  createInMemoryTransactionRunner,
  createStore,
  serviceId,
  type InMemoryRequestStore,
  type StoredActor,
  type StoredRequirement,
} from "../in-memory-requests";
import { minimalDocx, minimalPdf, syntheticText, windowsExecutable } from "../../attachments/synthetic-files";

const authorization = vi.hoisted(() => ({ requireRequestCreator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { createRequest } from "@/modules/requests/application/create-request";

const requester: StoredActor = {
  id: "requester-1",
  role: "REQUESTER",
  sectorId: null,
  isActive: true,
  name: "Requester",
  email: "requester@example.test",
};
const formId = "33333333-3333-4333-8333-333333333331";
const proofId = "33333333-3333-4333-8333-333333333332";
const foreignId = "33333333-3333-4333-8333-333333333333";

function requirements(): StoredRequirement[] {
  return [
    { id: formId, serviceId, name: "Request form", isRequired: true, acceptedFormats: ["PDF", "DOCX"], isActive: true },
    { id: proofId, serviceId, name: "Proof", isRequired: false, acceptedFormats: ["TXT"], isActive: true },
    {
      id: foreignId,
      serviceId: "44444444-4444-4444-8444-444444444444",
      name: "Other service",
      isRequired: false,
      acceptedFormats: ["PDF"],
      isActive: true,
    },
  ];
}

function storeWithRequirements(overrides: Partial<InMemoryRequestStore> = {}) {
  return createStore({
    actors: [requester],
    services: [activeService()],
    requirements: requirements(),
    ...overrides,
  });
}

const pdf = (requirementId = formId) => ({ requirementId, name: "form.pdf", bytes: minimalPdf() });
const text = (requirementId = proofId) => ({ requirementId, name: "proof.txt", bytes: syntheticText() });

function expectNothingPersisted(store: InMemoryRequestStore, storage: { size: number }) {
  expect(store.requests).toHaveLength(0);
  expect(store.events).toHaveLength(0);
  expect(store.attachments).toHaveLength(0);
  expect(storage.size).toBe(0);
}

describe("createRequest with documents (SPEC 21.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireRequestCreator.mockResolvedValue(requester);
  });

  it("stores objects and persists request, event and attachment metadata together (CA-DOC-13)", async () => {
    const store = storeWithRequirements();
    const storage = createMemoryDocumentStorage();

    const created = await createRequest(
      { serviceId, description: "Vacation", attachments: [pdf(), text()] },
      createInMemoryTransactionRunner(store),
      storage,
    );

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.events).toHaveLength(1);
    expect(store.attachments).toHaveLength(2);
    const [form, proof] = store.attachments;
    expect(form).toMatchObject({
      requestId: created.id,
      requirementId: formId,
      requirementNameSnapshot: "Request form",
      requirementRequiredSnapshot: true,
      originalFilename: "form.pdf",
      detectedFormat: "PDF",
      contentType: "application/pdf",
      sizeBytes: minimalPdf().length,
      sha256: sha256Hex(minimalPdf()),
      storageKey: `requests/${created.id}/${form.id}`,
      uploadedById: requester.id,
      createdAt: store.databaseTime,
    });
    expect(proof).toMatchObject({ requirementId: proofId, detectedFormat: "TXT", contentType: "text/plain" });
    expect(storage.size).toBe(2);
    await expect(storage.get(form.storageKey)).resolves.toEqual(minimalPdf());
  });

  it("opens a request with only the required documents (CA-DOC-07)", async () => {
    const store = storeWithRequirements();
    const storage = createMemoryDocumentStorage();

    await createRequest(
      { serviceId, description: "Vacation", attachments: [{ ...pdf(), name: "form.docx", bytes: minimalDocx() }] },
      createInMemoryTransactionRunner(store),
      storage,
    );

    expect(store.attachments).toEqual([expect.objectContaining({ detectedFormat: "DOCX" })]);
  });

  it("refuses a request without a required document and stores nothing (CA-DOC-07, CA-DOC-12)", async () => {
    const withFiles = storeWithRequirements();
    const storage = createMemoryDocumentStorage();
    await expect(
      createRequest(
        { serviceId, description: "Vacation", attachments: [text()] },
        createInMemoryTransactionRunner(withFiles),
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expectNothingPersisted(withFiles, storage);

    const withoutFiles = storeWithRequirements();
    await expect(
      createRequest(
        { serviceId, description: "Vacation" },
        createInMemoryTransactionRunner(withoutFiles),
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expectNothingPersisted(withoutFiles, storage);
  });

  it("rejects files for a service without active requirements and keeps the old flow (CA-DOC-05)", async () => {
    const store = createStore({ actors: [requester], services: [activeService()] });
    const storage = createMemoryDocumentStorage();

    await expect(
      createRequest(
        { serviceId, description: "Badge", attachments: [pdf()] },
        createInMemoryTransactionRunner(store),
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expectNothingPersisted(store, storage);

    await createRequest({ serviceId, description: "Badge" }, createInMemoryTransactionRunner(store));
    expect(store.requests).toHaveLength(1);
    expect(store.attachments).toHaveLength(0);
  });

  it("rejects inactive, foreign and duplicated requirements (CA-DOC-08)", async () => {
    const inactive = requirements().map((requirement) =>
      requirement.id === proofId ? { ...requirement, isActive: false } : requirement,
    );

    for (const [seed, attachments] of [
      [requirements(), [pdf(), pdf(foreignId)]],
      [requirements(), [pdf(), pdf()]],
      [inactive, [pdf(), text()]],
    ] as const) {
      const store = storeWithRequirements({ requirements: [...seed] });
      const storage = createMemoryDocumentStorage();

      await expect(
        createRequest(
          { serviceId, description: "Vacation", attachments: [...attachments] },
          createInMemoryTransactionRunner(store),
          storage,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expectNothingPersisted(store, storage);
    }
  });

  it("rejects disguised content, formats not accepted and size limits before storing (CA-DOC-09 to 11)", async () => {
    const cases = [
      [{ requirementId: formId, name: "form.pdf", bytes: windowsExecutable() }],
      [{ requirementId: formId, name: "form.pdf", bytes: syntheticText() }],
      [pdf(), { requirementId: proofId, name: "proof.pdf", bytes: minimalPdf() }],
      [{ requirementId: formId, name: "form.pdf", bytes: new Uint8Array() }],
      [{ requirementId: formId, name: "form.pdf", bytes: new Uint8Array(2 * 1024 * 1024 + 1) }],
    ];

    for (const attachments of cases) {
      const store = storeWithRequirements();
      const storage = createMemoryDocumentStorage();

      await expect(
        createRequest(
          { serviceId, description: "Vacation", attachments },
          createInMemoryTransactionRunner(store),
          storage,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expectNothingPersisted(store, storage);
    }
  });

  it("rejects client-provided storage metadata (CA-DOC-13)", async () => {
    const store = storeWithRequirements();
    const storage = createMemoryDocumentStorage();

    await expect(
      createRequest(
        {
          serviceId,
          description: "Vacation",
          attachments: [{ ...pdf(), storageKey: "requests/forged", sha256: "0".repeat(64) }],
        },
        createInMemoryTransactionRunner(store),
        storage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expectNothingPersisted(store, storage);
  });

  it("removes stored objects when the transaction fails (CA-DOC-12)", async () => {
    const store = storeWithRequirements();
    const storage = createMemoryDocumentStorage();
    const runner = createInMemoryTransactionRunner(store);
    const run = runner.run.bind(runner);
    let calls = 0;
    vi.spyOn(runner, "run").mockImplementation((work) => {
      calls += 1;
      // The configuration changes between the check and the final transaction.
      if (calls === 2) store.requirements = store.requirements.filter(({ id }) => id !== proofId);
      return run(work);
    });

    await expect(
      createRequest({ serviceId, description: "Vacation", attachments: [pdf(), text()] }, runner, storage),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.requests).toHaveLength(0);
    expect(store.attachments).toHaveLength(0);
    expect(storage.size).toBe(0);
  });

  it("removes objects already written when a later write fails", async () => {
    const store = storeWithRequirements();
    const memory = createMemoryDocumentStorage();
    const storage = {
      ...memory,
      put: vi
        .fn()
        .mockImplementationOnce(memory.put)
        .mockRejectedValueOnce(new DocumentStorageError("WRITE_FAILED")),
      remove: vi.fn(memory.remove),
    };

    await expect(
      createRequest(
        { serviceId, description: "Vacation", attachments: [pdf(), text()] },
        createInMemoryTransactionRunner(store),
        storage,
      ),
    ).rejects.toBeInstanceOf(DocumentStorageError);
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(memory.size).toBe(0);
    expect(store.requests).toHaveLength(0);
  });

  it("logs a failed compensation without keys, file names or content", async () => {
    const store = storeWithRequirements();
    const memory = createMemoryDocumentStorage();
    const storage = {
      ...memory,
      put: memory.put,
      remove: vi.fn().mockRejectedValue(new DocumentStorageError("DELETE_FAILED")),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const runner = createInMemoryTransactionRunner(store);
    const run = runner.run.bind(runner);
    let calls = 0;
    vi.spyOn(runner, "run").mockImplementation((work) => {
      calls += 1;
      if (calls === 2) store.services = [];
      return run(work);
    });

    try {
      await expect(
        createRequest({ serviceId, description: "Vacation", attachments: [pdf()] }, runner, storage),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(log).toHaveBeenCalledOnce();
      const logged = JSON.stringify(log.mock.calls[0]);
      expect(logged).toContain("DELETE_FAILED");
      expect(logged).not.toContain("requests/");
      expect(logged).not.toContain("form.pdf");
      expect(logged).not.toContain("%PDF");
    } finally {
      log.mockRestore();
    }
  });

  it("checks the session before reading files", async () => {
    authorization.requireRequestCreator.mockRejectedValueOnce(new NotFoundError());
    const store = storeWithRequirements();
    const storage = createMemoryDocumentStorage();

    await expect(
      createRequest(
        { serviceId, description: "Vacation", attachments: [pdf()] },
        createInMemoryTransactionRunner(store),
        storage,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expectNothingPersisted(store, storage);
  });
});
