import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/server/errors";
import {
  activeService,
  createInMemoryTransactionRunner,
  createStore,
  requestId,
  storedRequest,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireStatusChangeActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";

// SPEC 2026-10-31, section 5.3 (decision D2), SF-049.

const attendant = (id: string, overrides: Partial<StoredActor> = {}): StoredActor => ({
  id,
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name: id,
  email: `${id}@example.test`,
  ...overrides,
});
const ana = attendant("ana");
const bia = attendant("bia");

function storeWith(actors: StoredActor[], overrides: Parameters<typeof storedRequest>[0] = {}) {
  return createStore({ actors, services: [activeService()], requests: [storedRequest(overrides)] });
}

function actAs(actor: StoredActor) {
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: actor.sectorId });
}

describe("status changes with an assignee (CA-ATR-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the effective assignee start and complete", async () => {
    const store = storeWith([ana, bia], { assigneeId: "ana" });
    actAs(ana);

    await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, createInMemoryTransactionRunner(store));
    await transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ status: "COMPLETED", assigneeId: "ana" });
    expect(store.events.map(({ actorId }) => actorId)).toEqual(["ana", "ana"]);
  });

  it("refuses a colleague while the request is held, without changing anything", async () => {
    for (const [status, toStatus] of [
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ] as const) {
      const store = storeWith([ana, bia], { assigneeId: "ana", status });
      actAs(bia);

      await expect(
        transitionRequestStatus({ requestId, toStatus }, createInMemoryTransactionRunner(store)),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(store.requests[0].status).toBe(status);
      expect(store.events).toHaveLength(0);
    }
  });

  it("lets any attendant of the sector act when the assignee is no longer effective", async () => {
    for (const formerAssignee of [{ ...ana, isActive: false }, { ...ana, sectorId: "sector-2" }]) {
      const store = storeWith([formerAssignee, bia], { assigneeId: "ana" });
      actAs(bia);

      await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, createInMemoryTransactionRunner(store));
      expect(store.requests[0].status).toBe("IN_PROGRESS");
    }
  });

  it("rejects the change when the assignee changed after the read (section 5.8)", async () => {
    const store = storeWith([ana, bia]);
    actAs(bia);
    const runner = createInMemoryTransactionRunner(store);
    const run = runner.run.bind(runner);
    vi.spyOn(runner, "run").mockImplementation((work) =>
      run(async (transaction) => {
        const findLifecycleState = transaction.findLifecycleState.bind(transaction);
        transaction.findLifecycleState = async (id) => {
          const state = await findLifecycleState(id);
          store.requests[0].assigneeId = "ana"; // a colleague assumed meanwhile
          return state;
        };
        return work(transaction);
      }),
    );

    await expect(
      transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runner),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(store.requests[0].status).toBe("OPEN");
    expect(store.events).toHaveLength(0);
  });
});
