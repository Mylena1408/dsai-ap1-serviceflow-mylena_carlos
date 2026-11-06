import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDocumentStorage } from "@/server/storage";
import type { RequestTransaction, RequestTransactionRunner } from "@/modules/requests/application/ports";
import {
  activeService,
  createInMemoryTransactionRunner,
  createStore,
  requestId,
  serviceId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
} from "../in-memory-requests";
import { minimalPdf } from "../../attachments/synthetic-files";

// SPEC 2026-11-06-transacao-abertura (SF-142; CA-TXA-01, 03 to 05): the full history is read after
// the write transaction commits, in a transaction of its own.

const authorization = vi.hoisted(() => ({ requireRequestCreator: vi.fn(), requireStatusChangeActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { createRequest } from "@/modules/requests/application/create-request";
import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";
import {
  REQUEST_TRANSACTION_TIMEOUT_MS,
  createPrismaRequestTransactionRunner,
} from "@/modules/requests/infrastructure/prisma-request-repository";

const requester: StoredActor = { id: "requester-1", role: "REQUESTER", sectorId: null, isActive: true, name: "Requester", email: "r@example.test" };
const attendant: StoredActor = { id: "attendant-1", role: "ATTENDANT", sectorId: "sector-1", isActive: true, name: "Attendant", email: "a@example.test" };
const formId = "33333333-3333-4333-8333-333333333331";

type Failure = { method: keyof RequestTransaction; run: number };

/**
 * Wraps the in-memory runner, recording the methods each transaction called; `fail` makes one
 * method throw in one transaction (counted from 0), to simulate a failure there.
 */
function trackingRunner(store: InMemoryRequestStore, fail?: Failure) {
  const inner = createInMemoryTransactionRunner(store);
  const runs: string[][] = [];
  const runner: RequestTransactionRunner = {
    run(work) {
      const index = runs.length;
      const calls: string[] = [];
      runs.push(calls);
      return inner.run((transaction) =>
        work(
          new Proxy(transaction, {
            get(target, property, receiver) {
              const value = Reflect.get(target, property, receiver);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                calls.push(String(property));
                if (fail && fail.run === index && fail.method === property) throw new Error(`simulated ${String(property)} failure`);
                return (value as (...input: unknown[]) => unknown).apply(target, args);
              };
            },
          }),
        ),
      );
    },
  };
  return { runner, runs };
}

function openingStore() {
  return createStore({
    actors: [requester],
    services: [activeService()],
    requirements: [{ id: formId, serviceId, name: "Form", isRequired: false, acceptedFormats: ["PDF"], isActive: true }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authorization.requireRequestCreator.mockResolvedValue(requester);
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: attendant.id, sectorId: "sector-1" });
});

describe("opening: history read after the commit (CA-TXA-01)", () => {
  it("writes without reading the history, then reads it in a second transaction", async () => {
    const store = openingStore();
    const { runner, runs } = trackingRunner(store);

    const created = await createRequest({ serviceId, description: "Sem documentos" }, runner);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toContain("insertRequest");
    expect(runs[0]).not.toContain("getWithHistory");
    expect(runs[1]).toEqual(["getWithHistory"]);
    expect(created).toMatchObject({ status: "OPEN", description: "Sem documentos" });
    expect(created.events).toHaveLength(1);
  });

  it("with documents: checks, writes and only then reads", async () => {
    const store = openingStore();
    const storage = createMemoryDocumentStorage();
    const { runner, runs } = trackingRunner(store);

    await createRequest({ serviceId, description: "Com documento", attachments: [{ requirementId: formId, name: "f.pdf", bytes: minimalPdf() }] }, runner, storage);

    expect(runs).toHaveLength(3);
    expect(runs[1]).toEqual(expect.arrayContaining(["insertRequest", "insertAttachments"]));
    expect(runs.slice(0, 2).flat()).not.toContain("getWithHistory");
    expect(runs[2]).toEqual(["getWithHistory"]);
    expect(storage.size).toBe(1);
  });
});

describe("opening: failures (CA-TXA-03 and 04)", () => {
  it("does not read anything and removes the files when the write fails", async () => {
    const store = openingStore();
    const storage = createMemoryDocumentStorage();
    const { runner, runs } = trackingRunner(store, { method: "insertAttachments", run: 1 });

    await expect(
      createRequest({ serviceId, description: "Falha na escrita", attachments: [{ requirementId: formId, name: "f.pdf", bytes: minimalPdf() }] }, runner, storage),
    ).rejects.toThrow("simulated insertAttachments failure");

    expect(runs).toHaveLength(2);
    expect(runs.flat()).not.toContain("getWithHistory");
    expect(store.requests).toHaveLength(0);
    expect(store.attachments).toHaveLength(0);
    expect(storage.size).toBe(0);
  });

  it("keeps the saved request and its files when only the read after the commit fails", async () => {
    const store = openingStore();
    const storage = createMemoryDocumentStorage();
    const { runner } = trackingRunner(store, { method: "getWithHistory", run: 2 });

    await expect(
      createRequest({ serviceId, description: "Falha na leitura", attachments: [{ requirementId: formId, name: "f.pdf", bytes: minimalPdf() }] }, runner, storage),
    ).rejects.toThrow("simulated getWithHistory failure");

    expect(store.requests).toHaveLength(1);
    expect(store.attachments).toHaveLength(1);
    expect(storage.size).toBe(1);
  });

  it("keeps a request without documents when only the read fails", async () => {
    const store = openingStore();
    const { runner } = trackingRunner(store, { method: "getWithHistory", run: 1 });

    await expect(createRequest({ serviceId, description: "Sem documentos" }, runner)).rejects.toThrow("simulated getWithHistory failure");
    expect(store.requests).toHaveLength(1);
  });
});

describe("status change: history read after the commit (CA-TXA-01 and 03)", () => {
  function statusStore() {
    return createStore({ actors: [attendant], services: [activeService()], requests: [storedRequest({ status: "OPEN" })] });
  }

  it("changes the status without reading the history, then reads it", async () => {
    const store = statusStore();
    const { runner, runs } = trackingRunner(store);

    const started = await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runner);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(expect.arrayContaining(["updateStatusIfCurrent", "insertStatusEvent"]));
    expect(runs[0]).not.toContain("getWithHistory");
    expect(runs[1]).toEqual(["getWithHistory"]);
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("does not read the history when the change is refused", async () => {
    const store = statusStore();
    const { runner, runs } = trackingRunner(store);

    await expect(transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, runner)).rejects.toThrow();
    expect(runs).toHaveLength(1);
    expect(runs[0]).not.toContain("getWithHistory");
  });
});

describe("explicit limit of the request transactions (CA-TXA-05)", () => {
  it("passes a 10 s timeout and Serializable isolation to Prisma", async () => {
    const $transaction = vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work({}));
    const runner = createPrismaRequestTransactionRunner({ $transaction } as never, { translate: [], fallbackMessage: "x" });

    await runner.run(async () => "done");

    expect(REQUEST_TRANSACTION_TIMEOUT_MS).toBe(10_000);
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 10_000 });
  });
});
