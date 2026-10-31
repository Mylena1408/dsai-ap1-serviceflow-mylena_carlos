import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { REOPEN_WINDOW_MS } from "@/modules/requests/domain/lifecycle";
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

import { reopenRequest } from "@/modules/requests/application/lifecycle-actions";

// SPEC 2026-10-31, section 5.5 (decisions D4 and D5), SF-051.

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
const admin = person("admin", "ADMIN");

function completedStore(completedAgoMs: number, overrides: Parameters<typeof storedRequest>[0] = {}) {
  return createStore({
    actors: [owner, stranger, ana, admin],
    requests: [
      storedRequest({
        status: "COMPLETED",
        completedAt: new Date(fixedNow.getTime() - completedAgoMs),
        assigneeId: "ana",
        ...overrides,
      }),
    ],
  });
}

function expectUnchanged(store: InMemoryRequestStore) {
  expect(store.requests[0].status).not.toBe("OPEN");
  expect(store.events).toHaveLength(0);
}

describe("reopenRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue(owner);
  });

  it("returns the request to OPEN, clears completedAt and keeps the assignee (CA-ATR-09)", async () => {
    const store = completedStore(REOPEN_WINDOW_MS);

    await reopenRequest({ requestId, note: "  O problema voltou  " }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({
      status: "OPEN",
      completedAt: null,
      assigneeId: "ana",
      updatedAt: fixedNow,
    });
    expect(store.events).toEqual([
      expect.objectContaining({
        actorId: owner.id,
        fromStatus: "COMPLETED",
        toStatus: "OPEN",
        occurredAt: fixedNow,
        note: "O problema voltou",
      }),
    ]);
  });

  it("refuses after the 7-day window, measured with the database clock (CA-ATR-09)", async () => {
    const store = completedStore(REOPEN_WINDOW_MS + 1);

    await expect(
      reopenRequest({ requestId, note: "Voltou" }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(ConflictError);
    expectUnchanged(store);
  });

  it("requires a reason", async () => {
    for (const note of ["", "   ", "a".repeat(1_001)]) {
      const store = completedStore(1);
      await expect(
        reopenRequest({ requestId, note }, createInMemoryTransactionRunner(store)),
      ).rejects.toBeInstanceOf(ValidationError);
      expectUnchanged(store);
    }
    await expect(
      reopenRequest({ requestId }, createInMemoryTransactionRunner(completedStore(1))),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not reopen requests that are not completed (CA-ATR-08)", async () => {
    for (const status of ["OPEN", "IN_PROGRESS", "CANCELLED"] as const) {
      const store = completedStore(1, {
        status,
        completedAt: null,
        cancelledAt: status === "CANCELLED" ? fixedNow : null,
      });
      await expect(
        reopenRequest({ requestId, note: "x" }, createInMemoryTransactionRunner(store)),
      ).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it("hides the request from everyone but the owner (CA-ATR-10)", async () => {
    for (const actor of [stranger, ana, admin]) {
      const store = completedStore(1);
      authorization.requireCurrentActor.mockResolvedValue(actor);
      await expect(
        reopenRequest({ requestId, note: "x" }, createInMemoryTransactionRunner(store)),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(store.requests[0].status).toBe("COMPLETED");
    }
  });

  it("rejects forged fields (CA-ATR-14)", async () => {
    for (const input of [
      { requestId, note: "x", status: "OPEN" },
      { requestId, note: "x", completedAt: null },
      { requestId, note: "x", assigneeId: "ana" },
    ]) {
      await expect(reopenRequest(input, createInMemoryTransactionRunner(completedStore(1)))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(authorization.requireCurrentActor).not.toHaveBeenCalled();
  });
});
