import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  serviceId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
  type StoredStage,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({
  requireStatusChangeActor: vi.fn(),
  requireCurrentActor: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import { reopenRequest } from "@/modules/requests/application/lifecycle-actions";
import { moveRequestStage } from "@/modules/requests/application/stages";
import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";

// SPEC 2026-11-01-fluxos-configuraveis, sections 5.2 to 5.5 (SF-078).

const requester: StoredActor = {
  id: "requester-1",
  role: "REQUESTER",
  sectorId: null,
  isActive: true,
  name: "Rita",
  email: "rita@example.test",
};
const attendant: StoredActor = {
  id: "attendant-1",
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name: "Ana",
  email: "ana@example.test",
};
const colleague: StoredActor = { ...attendant, id: "attendant-2", name: "Beto", email: "beto@example.test" };

function stages(names: string[], extra: StoredStage[] = []): StoredStage[] {
  return [...names.map((name, position) => ({ serviceId, name, position, isActive: true })), ...extra];
}

function storeWith(overrides: Partial<InMemoryRequestStore> = {}) {
  return createStore({
    actors: [requester, attendant, colleague],
    requests: [storedRequest()],
    stages: stages(["Triagem", "Execução", "Testes"], [
      { serviceId, name: "Antiga", position: 1, isActive: false },
      { serviceId: "other-service", name: "Outra", position: 0, isActive: true },
    ]),
    ...overrides,
  });
}

const runner = (store: InMemoryRequestStore) => createInMemoryTransactionRunner(store);
const start = (store: InMemoryRequestStore) =>
  transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runner(store));
const complete = (store: InMemoryRequestStore) =>
  transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, runner(store));
// Sends the stage currently stored, as the page does with the stage it shows.
const move = (store: InMemoryRequestStore, direction: "advance" | "return", note?: string) =>
  moveRequestStage(
    {
      requestId,
      direction,
      fromStageIndex: store.requests[0].stageIndex ?? 0,
      ...(note !== undefined ? { note } : {}),
    },
    runner(store),
  );

function actAs(actor: StoredActor) {
  authorization.requireCurrentActor.mockResolvedValue(actor);
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: actor.sectorId });
}

describe("stages through the attendance (SF-078)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actAs(attendant);
  });

  it("copies the active stages on start, enters the first and records it (CA-FLX-04)", async () => {
    const store = storeWith();

    await start(store);

    expect(store.requests[0]).toMatchObject({
      status: "IN_PROGRESS",
      stageNamesSnapshot: ["Triagem", "Execução", "Testes"],
      stageIndex: 0,
    });
    expect(store.stageEvents).toEqual([
      {
        id: "stage-event-1",
        requestId,
        actorId: attendant.id,
        fromStage: null,
        toStage: "Triagem",
        note: null,
        occurredAt: fixedNow,
      },
    ]);
    expect(store.outbox.map(({ type }) => type)).toEqual(["request.status_changed", "request.stage_changed"]);
    expect(store.outbox[1].payload).toEqual({ stageEventId: "stage-event-1", direction: "start", actorId: attendant.id });
  });

  it("keeps the copy when the flow changes later (CA-FLX-04)", async () => {
    const store = storeWith();
    await start(store);

    store.stages = stages(["Nova"]);
    await move(store, "advance");

    expect(store.requests[0]).toMatchObject({ stageNamesSnapshot: ["Triagem", "Execução", "Testes"], stageIndex: 1 });
  });

  it("starts and completes a service without stages exactly as before (CA-FLX-01)", async () => {
    const store = storeWith({ stages: [] });

    await start(store);
    expect(store.requests[0]).toMatchObject({ status: "IN_PROGRESS", stageNamesSnapshot: [], stageIndex: null });
    await complete(store);

    expect(store.requests[0].status).toBe("COMPLETED");
    expect(store.stageEvents).toHaveLength(0);
    expect(store.outbox.map(({ type }) => type)).toEqual(["request.status_changed", "request.status_changed"]);
    await expect(move(store, "advance")).rejects.toBeInstanceOf(ConflictError);
  });

  it("advances, returns with a reason and records every move (CA-FLX-05, 08)", async () => {
    const store = storeWith();
    await start(store);

    await move(store, "advance");
    await move(store, "advance");
    await move(store, "return", "  Falhou no teste  ");

    expect(store.requests[0].stageIndex).toBe(1);
    expect(store.stageEvents.map(({ fromStage, toStage, note }) => [fromStage, toStage, note])).toEqual([
      [null, "Triagem", null],
      ["Triagem", "Execução", null],
      ["Execução", "Testes", null],
      ["Testes", "Execução", "Falhou no teste"],
    ]);
    expect(store.outbox.filter(({ type }) => type === "request.stage_changed").map(({ payload }) => payload)).toEqual([
      { stageEventId: "stage-event-1", direction: "start", actorId: attendant.id },
      { stageEventId: "stage-event-2", direction: "advance", actorId: attendant.id },
      { stageEventId: "stage-event-3", direction: "advance", actorId: attendant.id },
      { stageEventId: "stage-event-4", direction: "return", actorId: attendant.id },
    ]);
    // The reason stays in the history only (SPEC de eventos, 6.1).
    expect(JSON.stringify(store.outbox)).not.toContain("Falhou");
  });

  it("refuses a return without a reason and moves past either end, writing nothing (CA-FLX-05)", async () => {
    const store = storeWith();
    await start(store);

    await expect(move(store, "return", "motivo")).rejects.toBeInstanceOf(ConflictError);
    await move(store, "advance");
    await expect(move(store, "return")).rejects.toBeInstanceOf(ValidationError);
    await expect(move(store, "return", "   ")).rejects.toBeInstanceOf(ValidationError);
    await move(store, "advance");
    await expect(move(store, "advance")).rejects.toBeInstanceOf(ConflictError);

    expect(store.requests[0].stageIndex).toBe(2);
    expect(store.stageEvents).toHaveLength(3);
  });

  it("completes only at the last stage, with the SLA result as before (CA-FLX-06)", async () => {
    const store = storeWith();
    await start(store);

    await expect(complete(store)).rejects.toBeInstanceOf(ConflictError);
    await move(store, "advance");
    await expect(complete(store)).rejects.toBeInstanceOf(ConflictError);
    expect(store.requests[0].status).toBe("IN_PROGRESS");

    await move(store, "advance");
    await complete(store);
    expect(store.requests[0]).toMatchObject({ status: "COMPLETED", stageIndex: 2, completedLate: null });
  });

  it("refuses a move from a stage other than the one the person saw, as a double click (CA-FLX-07)", async () => {
    const store = storeWith();
    await start(store);

    await moveRequestStage({ requestId, direction: "advance", fromStageIndex: 0 }, runner(store));
    await expect(
      moveRequestStage({ requestId, direction: "advance", fromStageIndex: 0 }, runner(store)),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(store.requests[0].stageIndex).toBe(1);
    expect(store.stageEvents).toHaveLength(2);
  });

  it("refuses completion when the stage changed after it was read (CA-FLX-07)", async () => {
    const store = storeWith();
    store.requests[0] = { ...store.requests[0], status: "IN_PROGRESS", stageNamesSnapshot: ["A", "B"], stageIndex: 1 };
    const runnerThatMovesFirst = {
      async run<T>(work: Parameters<ReturnType<typeof runner>["run"]>[0]): Promise<T> {
        return runner(store).run(async (transaction) => {
          const original = transaction.findLifecycleState.bind(transaction);
          transaction.findLifecycleState = async (id) => {
            const state = await original(id);
            store.requests[0].stageIndex = 0; // a colleague went back meanwhile
            return state;
          };
          return work(transaction) as Promise<T>;
        });
      },
    };

    await expect(
      transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, runnerThatMovesFirst),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(store.requests[0].status).toBe("IN_PROGRESS");
  });

  it("lets only the effective assignee move a held request; others are refused (CA-FLX-07)", async () => {
    const store = storeWith();
    store.requests[0].assigneeId = attendant.id;
    await start(store);

    actAs(colleague);
    await expect(move(store, "advance")).rejects.toBeInstanceOf(ConflictError);
    actAs({ ...attendant, id: "outsider", sectorId: "sector-9" });
    store.actors.push({ ...attendant, id: "outsider", sectorId: "sector-9" });
    await expect(move(store, "advance")).rejects.toBeInstanceOf(NotFoundError);
    actAs(requester);
    await expect(move(store, "advance")).rejects.toBeInstanceOf(NotFoundError);

    actAs(attendant);
    await move(store, "advance");
    expect(store.requests[0].stageIndex).toBe(1);
  });

  it("clears the stage on reopening and copies the current flow on the next start (CA-FLX-09)", async () => {
    const store = storeWith();
    await start(store);
    await move(store, "advance");
    await move(store, "advance");
    await complete(store);

    actAs(requester);
    await reopenRequest({ requestId, note: "Voltou a falhar" }, runner(store));
    expect(store.requests[0]).toMatchObject({ status: "OPEN", stageNamesSnapshot: [], stageIndex: null });

    store.stages = stages(["Diagnóstico", "Reparo"]);
    actAs(attendant);
    await start(store);
    expect(store.requests[0]).toMatchObject({ stageNamesSnapshot: ["Diagnóstico", "Reparo"], stageIndex: 0 });
    expect(store.stageEvents.at(-1)).toMatchObject({ fromStage: null, toStage: "Diagnóstico" });
  });

  it("keeps the stage reached when the request is cancelled", async () => {
    const { cancelRequest } = await import("@/modules/requests/application/lifecycle-actions");
    const store = storeWith();
    await start(store);
    await move(store, "advance");

    await cancelRequest({ requestId, note: "Desistiu" }, runner(store));

    expect(store.requests[0]).toMatchObject({ status: "CANCELLED", stageIndex: 1 });
    await expect(move(store, "advance")).rejects.toBeInstanceOf(ConflictError);
  });
});
