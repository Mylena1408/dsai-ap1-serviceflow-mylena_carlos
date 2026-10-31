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

const authorization = vi.hoisted(() => ({ requireStatusChangeActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { assumeRequest, releaseRequest, transferRequest } from "@/modules/requests/application/assignment";

const attendant = (id: string, overrides: Partial<StoredActor> = {}): StoredActor => ({
  id,
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name: id,
  email: `${id}@example.test`,
  ...overrides,
});
const anaId = "33333333-3333-4333-8333-333333333331";
const biaId = "33333333-3333-4333-8333-333333333332";
const caioId = "33333333-3333-4333-8333-333333333333";
const ana = attendant(anaId);
const bia = attendant(biaId);
const caio = attendant(caioId, { sectorId: "sector-2" });

function storeWith(overrides: Parameters<typeof storedRequest>[0] = {}): InMemoryRequestStore {
  return createStore({ actors: [ana, bia, caio], requests: [storedRequest(overrides)] });
}

function actAs(actor: StoredActor) {
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: actor.sectorId });
}

describe("assignment use cases (SPEC 2026-10-31, section 5.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an attendant assume and records the event with the database time (CA-ATR-01)", async () => {
    const store = storeWith();
    actAs(ana);

    await assumeRequest({ requestId }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ assigneeId: anaId, updatedAt: fixedNow });
    expect(store.assignmentEvents).toEqual([
      { requestId, actorId: anaId, fromAssigneeId: null, toAssigneeId: anaId, occurredAt: fixedNow },
    ]);
    expect(authorization.requireStatusChangeActor).toHaveBeenCalledWith(requestId);
  });

  it("rejects assuming a held request and allows it when the holder left the sector (CA-ATR-02)", async () => {
    const held = storeWith({ assigneeId: anaId });
    actAs(bia);
    await expect(assumeRequest({ requestId }, createInMemoryTransactionRunner(held))).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(held.assignmentEvents).toHaveLength(0);

    const moved = createStore({
      actors: [{ ...ana, sectorId: "sector-2" }, bia],
      requests: [storedRequest({ assigneeId: anaId })],
    });
    await assumeRequest({ requestId }, createInMemoryTransactionRunner(moved));
    expect(moved.requests[0].assigneeId).toBe(biaId);
    expect(moved.assignmentEvents[0]).toMatchObject({ fromAssigneeId: anaId, toAssigneeId: biaId });
  });

  it("transfers only from the assignee to another active attendant of the sector (CA-ATR-03)", async () => {
    const store = storeWith({ assigneeId: anaId });
    actAs(ana);

    await transferRequest({ requestId, assigneeId: biaId }, createInMemoryTransactionRunner(store));
    expect(store.requests[0].assigneeId).toBe(biaId);
    expect(store.assignmentEvents[0]).toMatchObject({ actorId: anaId, fromAssigneeId: anaId, toAssigneeId: biaId });

    for (const target of [biaId, caioId, "44444444-4444-4444-8444-444444444444"]) {
      const other = storeWith({ assigneeId: biaId });
      actAs(bia);
      await expect(
        transferRequest({ requestId, assigneeId: target }, createInMemoryTransactionRunner(other)),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(other.requests[0].assigneeId).toBe(biaId);
    }

    const notMine = storeWith({ assigneeId: anaId });
    actAs(bia);
    await expect(
      transferRequest({ requestId, assigneeId: biaId }, createInMemoryTransactionRunner(notMine)),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets the assignee release (CA-ATR-04)", async () => {
    const store = storeWith({ assigneeId: anaId, status: "IN_PROGRESS" });
    actAs(ana);

    await releaseRequest({ requestId }, createInMemoryTransactionRunner(store));

    expect(store.requests[0].assigneeId).toBeNull();
    expect(store.assignmentEvents[0]).toMatchObject({ fromAssigneeId: anaId, toAssigneeId: null });
  });

  it("refuses assignment on completed or cancelled requests", async () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      const store = storeWith({ status });
      actAs(ana);
      await expect(assumeRequest({ requestId }, createInMemoryTransactionRunner(store))).rejects.toBeInstanceOf(
        ConflictError,
      );
    }
  });

  it("hides the request from an attendant who is no longer in its sector", async () => {
    const store = createStore({ actors: [{ ...ana, sectorId: "sector-2" }], requests: [storedRequest()] });
    actAs(ana);

    await expect(assumeRequest({ requestId }, createInMemoryTransactionRunner(store))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("detects a change between the read and the write (CA-ATR-11)", async () => {
    const store = storeWith();
    actAs(ana);
    const runner = createInMemoryTransactionRunner(store);
    const run = runner.run.bind(runner);
    vi.spyOn(runner, "run").mockImplementation((work) =>
      run(async (transaction) => {
        const findLifecycleState = transaction.findLifecycleState.bind(transaction);
        transaction.findLifecycleState = async (id) => {
          const state = await findLifecycleState(id);
          store.requests[0].assigneeId = biaId; // a colleague assumed meanwhile
          return state;
        };
        return work(transaction);
      }),
    );

    await expect(assumeRequest({ requestId }, runner)).rejects.toBeInstanceOf(ConflictError);
    expect(store.assignmentEvents).toHaveLength(0);
  });

  it("rejects forged fields and malformed identifiers before any check (CA-ATR-14)", async () => {
    const store = storeWith();

    for (const input of [
      { requestId, assigneeId: anaId },
      { requestId, sectorId: "sector-2" },
      { requestId: "not-an-id" },
    ]) {
      await expect(assumeRequest(input, createInMemoryTransactionRunner(store))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      transferRequest({ requestId, assigneeId: biaId, actorId: anaId }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(authorization.requireStatusChangeActor).not.toHaveBeenCalled();
  });
});
