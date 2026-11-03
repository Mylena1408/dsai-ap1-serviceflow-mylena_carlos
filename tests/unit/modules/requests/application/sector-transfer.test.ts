import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createInMemoryQueryRepository,
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({
  requireStatusChangeActor: vi.fn(),
  requireCurrentActor: vi.fn(),
  assertRole: vi.fn((actor: unknown) => actor),
  actorHasPermission: vi.fn(async () => false),
}));
vi.mock("@/server/authorization", () => authorization);

import { listSectorDestinations, sendRequestToSector } from "@/modules/requests/application/sector-transfer";

// SPEC 2026-11-03-transferencia-entre-setores, 5.1 to 5.3 (SF-121).

const currentSector = "44444444-4444-4444-8444-444444444441";
const maintenance = "44444444-4444-4444-8444-444444444442";
const people = "44444444-4444-4444-8444-444444444443";
const closed = "44444444-4444-4444-8444-444444444444";

const attendant = (id: string, sectorId = currentSector, overrides: Partial<StoredActor> = {}): StoredActor => ({
  id,
  role: "ATTENDANT",
  sectorId,
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
const caio = attendant(caioId, maintenance);

function storeWith(overrides: Parameters<typeof storedRequest>[0] = {}, seed: Partial<InMemoryRequestStore> = {}) {
  return createStore({
    actors: [ana, bia, caio, attendant("dani", closed, { isActive: false })],
    sectors: [
      { id: currentSector, name: "Atendimento", isActive: true },
      { id: maintenance, name: "Manutenção", isActive: true },
      { id: people, name: "Pessoas", isActive: true },
      { id: closed, name: "Antigo", isActive: false },
    ],
    requests: [storedRequest({ sectorId: currentSector, sectorNameSnapshot: "Atendimento", ...overrides })],
    ...seed,
  });
}

function actAs(actor: StoredActor) {
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: actor.sectorId });
  authorization.requireCurrentActor.mockResolvedValue(actor);
}

const send = (store: InMemoryRequestStore, input: Record<string, unknown> = {}) =>
  sendRequestToSector(
    { requestId, sectorId: maintenance, note: "  Pedido é da manutenção  ", ...input },
    createInMemoryTransactionRunner(store),
  );

describe("sending a request to another sector (5.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves the request, removes the assignee and writes history and events at the database time (CA-SET-02)", async () => {
    const store = storeWith({ assigneeId: anaId, priority: "HIGH", dueAt: new Date("2026-10-30T12:00:00.000Z") });
    actAs(ana);

    await send(store);

    expect(store.requests[0]).toMatchObject({
      sectorId: maintenance,
      sectorNameSnapshot: "Manutenção",
      assigneeId: null,
      status: "OPEN",
      priority: "HIGH",
      dueAt: new Date("2026-10-30T12:00:00.000Z"),
      updatedAt: fixedNow,
    });
    expect(store.sectorEvents).toEqual([
      {
        requestId,
        actorId: anaId,
        fromSectorId: currentSector,
        toSectorId: maintenance,
        fromSectorName: "Atendimento",
        toSectorName: "Manutenção",
        note: "Pedido é da manutenção",
        occurredAt: fixedNow,
      },
    ]);
    expect(store.assignmentEvents).toEqual([
      { requestId, actorId: anaId, fromAssigneeId: anaId, toAssigneeId: null, occurredAt: fixedNow },
    ]);
    expect(store.outbox.map(({ type, payload }) => ({ type, payload }))).toEqual([
      { type: "request.assignment_changed", payload: { fromAssigneeId: anaId, toAssigneeId: null, actorId: anaId } },
      { type: "request.sector_changed", payload: { fromSectorId: currentSector, toSectorId: maintenance, actorId: anaId } },
    ]);
  });

  it("without an assignee, lets any attendant of the sector send it, with no assignment event", async () => {
    const store = storeWith();
    actAs(bia);

    await send(store);

    expect(store.requests[0]?.sectorId).toBe(maintenance);
    expect(store.assignmentEvents).toEqual([]);
    expect(store.outbox.map(({ type }) => type)).toEqual(["request.sector_changed"]);
  });

  it("refuses a colleague's request unless the actor supervises the queue (5.1.2)", async () => {
    const held = storeWith({ assigneeId: anaId });
    actAs(bia);
    await expect(send(held)).rejects.toThrow(ConflictError);
    expect(held.requests[0]?.sectorId).toBe(currentSector);

    const supervised = storeWith({ assigneeId: anaId }, { permissions: { [biaId]: ["QUEUE_SUPERVISION"] } });
    await send(supervised);
    expect(supervised.requests[0]).toMatchObject({ sectorId: maintenance, assigneeId: null });
  });

  it("refuses requests that are not open or wait for an approval, and changes nothing (CA-SET-03)", async () => {
    actAs(ana);
    for (const overrides of [{ status: "IN_PROGRESS" as const }, { status: "COMPLETED" as const }, { approvalState: "PENDING" as const }]) {
      const store = storeWith(overrides);
      await expect(send(store), JSON.stringify(overrides)).rejects.toThrow(ConflictError);
      expect(store.sectorEvents).toEqual([]);
      expect(store.outbox).toEqual([]);
    }
  });

  it("requires a reason and a valid destination, on their fields (CA-SET-03)", async () => {
    actAs(ana);
    const issuePath = async (input: Record<string, unknown>) => {
      const error = await send(storeWith(), input).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      return (error as ValidationError).issues[0]?.path;
    };

    expect(await issuePath({ note: "   " })).toEqual(["note"]);
    expect(await issuePath({ note: undefined })).toEqual(["note"]);
    expect(await issuePath({ note: "x".repeat(1_001) })).toEqual(["note"]);
    // The current sector, an inactive one, one without an active attendant and an unknown one.
    for (const sectorId of [currentSector, closed, people, "44444444-4444-4444-8444-444444444449"]) {
      expect(await issuePath({ sectorId }), sectorId).toEqual(["sectorId"]);
    }
    expect(await issuePath({ sectorId: "nao-e-id" })).toEqual(["sectorId"]);
  });

  it("hides the request from an attendant of another sector", async () => {
    actAs(caio);
    await expect(send(storeWith())).rejects.toThrow(NotFoundError);
  });
});

describe("sectors offered as destination (5.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists active, different sectors with an active attendant, by name", async () => {
    const store = storeWith({}, { actors: [ana, caio, attendant("eva", people)] });
    actAs(ana);

    await expect(listSectorDestinations(requestId, createInMemoryQueryRepository(store))).resolves.toEqual([
      { id: maintenance, name: "Manutenção" },
      { id: people, name: "Pessoas" },
    ]);
  });
});
