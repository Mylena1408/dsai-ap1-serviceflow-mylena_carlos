import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { decideApproval } from "@/modules/requests/application/approval";

// SPEC 2026-11-01-aprovacoes, sections 5.3 to 5.6 (SF-084).

const HOUR = 60 * 60 * 1000;
const manager: StoredActor = {
  id: "manager-1",
  role: "MANAGER",
  sectorId: "sector-1",
  isActive: true,
  name: "Gabi",
  email: "gabi@example.test",
};
const otherManager: StoredActor = { ...manager, id: "manager-2", sectorId: "sector-2", name: "Otto" };

function storeWithPending(overrides: Parameters<typeof storedRequest>[0] = {}) {
  return createStore({
    actors: [manager, otherManager],
    requests: [storedRequest({ approvalState: "PENDING", slaHoursSnapshot: 10, ...overrides })],
  });
}

const decide = (store: InMemoryRequestStore, decision: "APPROVED" | "REJECTED", note?: string) =>
  decideApproval({ requestId, decision, ...(note !== undefined ? { note } : {}) }, createInMemoryTransactionRunner(store));

describe("manager decision (SF-084)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue(manager);
  });

  it("approves, starting the SLA at the approval, and records the decision and the event (CA-APR-07, 08)", async () => {
    const store = storeWithPending();

    await decide(store, "APPROVED", " Dentro do orçamento ");

    expect(store.requests[0]).toMatchObject({ status: "OPEN", approvalState: "APPROVED" });
    expect(store.requests[0].dueAt?.getTime()).toBe(fixedNow.getTime() + 10 * HOUR);
    expect(store.approvals).toEqual([
      { requestId, deciderId: manager.id, decision: "APPROVED", note: "Dentro do orçamento", decidedAt: fixedNow },
    ]);
    expect(store.outbox).toEqual([
      expect.objectContaining({ type: "request.approval_decided", payload: { decision: "APPROVED", actorId: manager.id } }),
    ]);
    expect(store.events).toHaveLength(0);
  });

  it("rejects with a note, cancelling the request in the same transaction (CA-APR-06)", async () => {
    const store = storeWithPending();

    await decide(store, "REJECTED", "Fora do orçamento do trimestre");

    expect(store.requests[0]).toMatchObject({ status: "CANCELLED", approvalState: "REJECTED", dueAt: null, cancelledAt: fixedNow });
    expect(store.events).toEqual([
      expect.objectContaining({ fromStatus: "OPEN", toStatus: "CANCELLED", actorId: manager.id, note: "Fora do orçamento do trimestre" }),
    ]);
    expect(store.outbox.map(({ type }) => type)).toEqual(["request.status_changed", "request.approval_decided"]);
    // The note stays out of the events (SPEC de eventos, 6.1).
    expect(JSON.stringify(store.outbox)).not.toContain("orçamento");
  });

  it("refuses a rejection without a note and writes nothing (CA-APR-06)", async () => {
    const store = storeWithPending();

    await expect(decide(store, "REJECTED")).rejects.toBeInstanceOf(ValidationError);
    await expect(decide(store, "REJECTED", "   ")).rejects.toBeInstanceOf(ValidationError);
    expect(store.requests[0]).toMatchObject({ status: "OPEN", approvalState: "PENDING" });
    expect(store.approvals).toHaveLength(0);
    expect(store.outbox).toHaveLength(0);
  });

  it("decides only once (CA-APR-06)", async () => {
    const store = storeWithPending();
    await decide(store, "APPROVED");

    await expect(decide(store, "REJECTED", "Mudei de ideia")).rejects.toBeInstanceOf(ConflictError);
    expect(store.approvals).toHaveLength(1);
  });

  it("refuses a decision when the request is no longer pending when written", async () => {
    const store = storeWithPending();
    const runner = createInMemoryTransactionRunner(store);
    const decidedMeanwhile = {
      async run<T>(work: Parameters<typeof runner.run>[0]): Promise<T> {
        return runner.run(async (transaction) => {
          const read = transaction.findLifecycleState.bind(transaction);
          transaction.findLifecycleState = async (id) => {
            const state = await read(id);
            store.requests[0].approvalState = "APPROVED"; // another manager decided meanwhile
            return state;
          };
          return work(transaction) as Promise<T>;
        });
      },
    };

    await expect(decideApproval({ requestId, decision: "APPROVED" }, decidedMeanwhile)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(store.approvals).toHaveLength(0);
  });

  it("hides the request from managers of other sectors and from other roles (CA-APR-06)", async () => {
    const attendant: StoredActor = { ...manager, id: "attendant-1", role: "ATTENDANT" };
    const store = storeWithPending();
    store.actors.push(attendant);

    for (const actor of [otherManager, attendant]) {
      authorization.requireCurrentActor.mockResolvedValue(actor);
      await expect(decide(store, "APPROVED")).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(store.requests[0].approvalState).toBe("PENDING");
  });

  it("does not decide requests that never required approval", async () => {
    const store = createStore({ actors: [manager], requests: [storedRequest()] });

    await expect(decide(store, "APPROVED")).rejects.toBeInstanceOf(NotFoundError);
  });
});
