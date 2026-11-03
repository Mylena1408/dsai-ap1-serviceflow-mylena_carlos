import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { minimalPdf, syntheticText } from "../../attachments/synthetic-files";
import {
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  serviceId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { addLateDocument } from "@/modules/requests/application/late-document";
import { plannedNotifications } from "@/modules/notifications/domain/recipients";
import { notificationCategory } from "@/modules/notifications/domain/email";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-03-anexos-comentarios-documentos, 5.3 (SF-126; CA-ANX-05 to 07).

const requirementId = "55555555-5555-4555-8555-555555555551";
const otherRequirementId = "55555555-5555-4555-8555-555555555552";
const rita: StoredActor = { id: "requester-1", role: "REQUESTER", sectorId: null, isActive: true, name: "Rita", email: "rita@example.test" };
const ana: StoredActor = { id: "ana", role: "ATTENDANT", sectorId: "sector-1", isActive: true, name: "Ana", email: "ana@example.test" };

function setup(overrides: Parameters<typeof storedRequest>[0] = {}): { store: InMemoryRequestStore; objects: Map<string, Uint8Array> } {
  const store = createStore({
    actors: [rita, ana],
    requests: [storedRequest(overrides)],
    requirements: [
      { id: requirementId, serviceId, name: "Comprovante", isRequired: false, acceptedFormats: ["PDF"], isActive: true },
      { id: otherRequirementId, serviceId, name: "Antigo", isRequired: false, acceptedFormats: ["PDF"], isActive: false },
    ],
  });
  return { store, objects: new Map() };
}

function storage(objects: Map<string, Uint8Array>) {
  return {
    async put(key: string, bytes: Uint8Array) {
      objects.set(key, bytes);
    },
    async remove(key: string) {
      objects.delete(key);
    },
  };
}

const send = (store: InMemoryRequestStore, objects: Map<string, Uint8Array>, overrides: Record<string, unknown> = {}) =>
  addLateDocument(
    { requestId, requirementId, file: { name: "comprovante.pdf", bytes: minimalPdf() }, ...overrides },
    createInMemoryTransactionRunner(store),
    storage(objects),
  );

describe("document after the opening (5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue(rita);
  });

  it("stores the document with the database time and records the event (CA-ANX-05)", async () => {
    const { store, objects } = setup();

    await send(store, objects);

    expect(store.attachments).toEqual([
      expect.objectContaining({
        requestId,
        requirementId,
        requirementNameSnapshot: "Comprovante",
        requirementRequiredSnapshot: false,
        originalFilename: "comprovante.pdf",
        detectedFormat: "PDF",
        uploadedById: rita.id,
        createdAt: fixedNow,
      }),
    ]);
    expect([...objects.keys()]).toEqual([store.attachments[0]!.storageKey]);
    expect(store.outbox).toEqual([
      { type: "request.document_added", requestId, occurredAt: fixedNow, payload: { attachmentId: store.attachments[0]!.id, actorId: rita.id } },
    ]);
  });

  it("refuses without storing anything (CA-ANX-06)", async () => {
    const cases: Array<[Record<string, unknown>, Parameters<typeof storedRequest>[0], new (...args: never[]) => Error]> = [
      [{ requirementId: otherRequirementId }, {}, ValidationError],
      [{ file: { name: "nota.txt", bytes: syntheticText() } }, {}, ValidationError],
      [{ file: { name: "", bytes: new Uint8Array() } }, {}, ValidationError],
      [{}, { status: "COMPLETED" }, ConflictError],
    ];
    for (const [input, request, error] of cases) {
      const { store, objects } = setup(request);
      await expect(send(store, objects, input), JSON.stringify(input).slice(0, 40)).rejects.toThrow(error);
      expect(objects.size).toBe(0);
      expect(store.attachments).toEqual([]);
    }

    // A second document for the same requirement, and someone who is not the owner.
    const { store, objects } = setup();
    await send(store, objects);
    await expect(send(store, objects)).rejects.toThrow(ValidationError);
    authorization.requireCurrentActor.mockResolvedValue(ana);
    await expect(send(setup().store, objects)).rejects.toThrow(NotFoundError);
  });

  it("removes the object when the transaction fails (CA-ANX-07)", async () => {
    const { store, objects } = setup();
    const runner = createInMemoryTransactionRunner(store);
    let calls = 0;
    const failing = {
      run: <T>(work: Parameters<typeof runner.run<T>>[0]) => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error("database down")) : runner.run(work);
      },
    };

    await expect(
      addLateDocument({ requestId, requirementId, file: { name: "comprovante.pdf", bytes: minimalPdf() } }, failing, storage(objects)),
    ).rejects.toThrow("database down");
    expect(objects.size).toBe(0);
  });
});

describe("notification and history of a document sent later", () => {
  it("notifies the effective assignee in the comments category, and nobody without one (X7)", () => {
    const event = { type: "request.document_added" as const, payload: { actorId: "rita" } };
    expect(plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: "ana" })).toEqual([
      { recipientId: "ana", type: "document.added" },
    ]);
    expect(plannedNotifications(event, { requesterId: "rita", effectiveAssigneeId: null })).toEqual([]);
    expect(notificationCategory("document.added")).toBe("COMMENTS");
  });

  it("lists only documents sent after the opening", () => {
    const opened = new Date("2026-11-03T12:00:00.000Z");
    const request = {
      createdAt: opened,
      events: [],
      assignmentEvents: [],
      priorityEvents: [],
      stageEvents: [],
      attachments: [
        { id: "d1", requirementNameSnapshot: "Formulário", createdAt: opened, uploadedBy: { id: "rita", name: "Rita" } },
        { id: "d2", requirementNameSnapshot: "Comprovante", createdAt: new Date("2026-11-03T13:00:00.000Z"), uploadedBy: { id: "rita", name: "Rita" } },
      ],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(request).map(({ title, actor }) => [title, actor])).toEqual([["Documento enviado: Comprovante", "Rita"]]);
  });
});
