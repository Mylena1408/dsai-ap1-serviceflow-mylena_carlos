import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "@/server/errors";
import {
  activeService,
  createInMemoryTransactionRunner,
  createStore,
  serviceId,
  type StoredActor,
} from "../in-memory-requests";

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

describe("createRequest use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireRequestCreator.mockResolvedValue(requester);
  });

  it("opens the request with service snapshots and an initial OPEN event", async () => {
    const store = createStore({ actors: [requester], services: [activeService()] });

    const created = await createRequest(
      { serviceId, description: "Need a new badge" },
      createInMemoryTransactionRunner(store),
    );

    expect(created).toMatchObject({
      requesterId: "requester-1",
      serviceId,
      sectorId: "sector-1",
      serviceNameSnapshot: "Service",
      categoryNameSnapshot: "Category",
      sectorNameSnapshot: "Sector",
      description: "Need a new badge",
      status: "OPEN",
    });
    expect(created.events).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "OPEN", actorId: "requester-1" }),
    ]);
    expect(store.requests).toHaveLength(1);
  });

  it("stamps the request and its first event with the database time (CA-HOR-01)", async () => {
    const databaseTime = new Date("2026-10-30T08:15:00.000Z");
    const store = createStore({ databaseTime, actors: [requester], services: [activeService()] });

    const created = await createRequest(
      { serviceId, description: "Need a new badge" },
      createInMemoryTransactionRunner(store),
    );

    expect(created.createdAt).toEqual(databaseTime);
    expect(created.updatedAt).toEqual(databaseTime);
    expect(created.events[0].occurredAt).toEqual(databaseTime);
  });

  it("hides an inactive service and leaves nothing behind", async () => {
    const store = createStore({
      actors: [requester],
      services: [activeService({ isActive: false })],
    });

    await expect(
      createRequest(
        { serviceId, description: "Need a new badge" },
        createInMemoryTransactionRunner(store),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.requests).toHaveLength(0);
    expect(store.events).toHaveLength(0);
  });

  it("hides an unknown service and an actor that is no longer an active requester", async () => {
    const unknownService = createStore({ actors: [requester] });
    await expect(
      createRequest({ serviceId, description: "x" }, createInMemoryTransactionRunner(unknownService)),
    ).rejects.toBeInstanceOf(NotFoundError);

    const inactiveActor = createStore({
      actors: [{ ...requester, isActive: false }],
      services: [activeService()],
    });
    await expect(
      createRequest({ serviceId, description: "x" }, createInMemoryTransactionRunner(inactiveActor)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validates input before touching the repository", async () => {
    const store = createStore({ actors: [requester], services: [activeService()] });
    const runner = createInMemoryTransactionRunner(store);
    const run = vi.spyOn(runner, "run");

    await expect(
      createRequest({ serviceId, description: "   " }, runner),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(run).not.toHaveBeenCalled();
  });
});
