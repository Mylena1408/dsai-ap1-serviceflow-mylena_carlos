import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";
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

const attendant: StoredActor = {
  id: "attendant-1",
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name: "Attendant",
  email: "attendant@example.test",
};
const transitionTime = new Date("2026-10-29T15:30:00.000Z");

function seededStore(status: "OPEN" | "IN_PROGRESS" | "COMPLETED" = "OPEN") {
  return createStore({
    databaseTime: transitionTime,
    actors: [attendant],
    services: [activeService()],
    requests: [storedRequest({ status })],
  });
}

describe("transitionRequestStatus use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireStatusChangeActor.mockResolvedValue({
      actorId: attendant.id,
      sectorId: "sector-1",
    });
  });

  it("starts and completes a request, recording one event per change", async () => {
    const store = seededStore();
    const runner = createInMemoryTransactionRunner(store);

    const started = await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runner);
    expect(started).toMatchObject({ status: "IN_PROGRESS", updatedAt: transitionTime, completedAt: null });

    const completed = await transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, runner);
    expect(completed).toMatchObject({ status: "COMPLETED", completedAt: transitionTime });
    expect(completed.events.map(({ fromStatus, toStatus }) => [fromStatus, toStatus])).toEqual([
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ]);
  });

  it("uses one database time per transition for the request and its event (CA-HOR-02)", async () => {
    const store = seededStore();
    const runner = createInMemoryTransactionRunner(store);

    const started = await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runner);
    store.databaseTime = new Date("2026-10-29T16:45:00.000Z");
    const completed = await transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, runner);

    expect(started.events.at(-1)?.occurredAt).toEqual(started.updatedAt);
    expect(completed.updatedAt).toEqual(store.databaseTime);
    expect(completed.completedAt).toEqual(store.databaseTime);
    expect(completed.events.at(-1)?.occurredAt).toEqual(store.databaseTime);
  });

  it("rejects a transition that skips a state without recording an event", async () => {
    const store = seededStore("OPEN");

    await expect(
      transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(store.requests[0].status).toBe("OPEN");
    expect(store.events).toHaveLength(0);
  });

  it("hides the request from an attendant moved to another sector", async () => {
    const store = seededStore();
    store.actors[0] = { ...attendant, sectorId: "sector-2" };

    await expect(
      transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports a conflict when the status changed concurrently", async () => {
    const store = seededStore();
    const runner = createInMemoryTransactionRunner(store);
    const original = runner.run.bind(runner);
    vi.spyOn(runner, "run").mockImplementation((work) =>
      original((transaction) =>
        work({ ...transaction, updateStatusIfCurrent: async () => 0 }),
      ),
    );

    await expect(
      transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, runner),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(store.events).toHaveLength(0);
  });
});
