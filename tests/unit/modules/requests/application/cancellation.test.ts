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

import { cancelRequest } from "@/modules/requests/application/lifecycle-actions";

// SPEC 2026-10-31, section 5.4 (decision D3), SF-050.

const person = (id: string, role: StoredActor["role"], sectorId: string | null = null): StoredActor => ({
  id,
  role,
  sectorId,
  isActive: true,
  name: id,
  email: `${id}@example.test`,
});
const owner = person("requester-1", "REQUESTER");
const stranger = person("requester-2", "REQUESTER");
const ana = person("ana", "ATTENDANT", "sector-1");
const bia = person("bia", "ATTENDANT", "sector-1");
const caio = person("caio", "ATTENDANT", "sector-2");
const admin = person("admin", "ADMIN");

function storeWith(overrides: Parameters<typeof storedRequest>[0] = {}): InMemoryRequestStore {
  return createStore({ actors: [owner, stranger, ana, bia, caio, admin], requests: [storedRequest(overrides)] });
}

function actAs(actor: StoredActor) {
  authorization.requireCurrentActor.mockResolvedValue(actor);
}

function expectUnchanged(store: InMemoryRequestStore, status: string) {
  expect(store.requests[0]).toMatchObject({ status, cancelledAt: null });
  expect(store.events).toHaveLength(0);
}

describe("cancelRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the owner cancel an open request, with or without reason (CA-ATR-06)", async () => {
    for (const note of [undefined, "  ", "Resolvi por conta própria"]) {
      const store = storeWith();
      actAs(owner);

      await cancelRequest({ requestId, note }, createInMemoryTransactionRunner(store));

      expect(store.requests[0]).toMatchObject({ status: "CANCELLED", cancelledAt: fixedNow, updatedAt: fixedNow });
      expect(store.events).toEqual([
        expect.objectContaining({
          actorId: owner.id,
          fromStatus: "OPEN",
          toStatus: "CANCELLED",
          occurredAt: fixedNow,
          note: note?.trim() || null,
        }),
      ]);
    }
  });

  it("does not let the owner cancel after the attendance started (CA-ATR-06)", async () => {
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      const store = storeWith({ status, ...(status === "CANCELLED" ? { cancelledAt: fixedNow } : {}) });
      actAs(owner);
      await expect(cancelRequest({ requestId }, createInMemoryTransactionRunner(store))).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(store.events).toHaveLength(0);
    }
  });

  it("requires a reason from the attendant of the sector (CA-ATR-07)", async () => {
    const missing = storeWith({ status: "IN_PROGRESS" });
    actAs(ana);
    await expect(
      cancelRequest({ requestId, note: "   " }, createInMemoryTransactionRunner(missing)),
    ).rejects.toBeInstanceOf(ValidationError);
    expectUnchanged(missing, "IN_PROGRESS");

    const tooLong = storeWith();
    await expect(
      cancelRequest({ requestId, note: "a".repeat(1_001) }, createInMemoryTransactionRunner(tooLong)),
    ).rejects.toBeInstanceOf(ValidationError);
    expectUnchanged(tooLong, "OPEN");

    const ok = storeWith({ status: "IN_PROGRESS" });
    await cancelRequest({ requestId, note: "Duplicada da solicitação 12" }, createInMemoryTransactionRunner(ok));
    expect(ok.requests[0].status).toBe("CANCELLED");
    expect(ok.events[0]).toMatchObject({ actorId: "ana", note: "Duplicada da solicitação 12" });
  });

  it("respects the assignee: only the effective assignee cancels a held request", async () => {
    const store = storeWith({ assigneeId: "ana" });
    actAs(bia);

    await expect(
      cancelRequest({ requestId, note: "Duplicada" }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(ConflictError);
    expectUnchanged(store, "OPEN");
  });

  it("hides the request from other requesters, other sectors and administrators (CA-ATR-10)", async () => {
    for (const actor of [stranger, caio, admin]) {
      const store = storeWith();
      actAs(actor);
      await expect(
        cancelRequest({ requestId, note: "x" }, createInMemoryTransactionRunner(store)),
      ).rejects.toBeInstanceOf(NotFoundError);
      expectUnchanged(store, "OPEN");
    }
  });

  it("rejects forged fields before touching the session (CA-ATR-14)", async () => {
    const store = storeWith();

    for (const input of [
      { requestId, note: "x", status: "CANCELLED" },
      { requestId, cancelledAt: "2026-01-01" },
      { requestId, actorId: "ana" },
    ]) {
      await expect(cancelRequest(input, createInMemoryTransactionRunner(store))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(authorization.requireCurrentActor).not.toHaveBeenCalled();
  });
});
