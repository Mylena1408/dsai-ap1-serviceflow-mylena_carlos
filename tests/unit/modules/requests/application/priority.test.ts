import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  storedRequest,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireStatusChangeActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { changeRequestPriority } from "@/modules/requests/application/priority";
import { dueAtAfterPriorityChange } from "@/modules/requests/domain/sla";

// SPEC 2026-11-01-sla-prioridades, sections 5.1 and 5.3 (SF-067).

const MINUTE = 60_000;
const attendant = (id: string, sectorId = "sector-1"): StoredActor => ({
  id,
  role: "ATTENDANT",
  sectorId,
  isActive: true,
  name: id,
  email: `${id}@example.test`,
});
const ana = attendant("ana");
const bia = attendant("bia");
const caio = attendant("caio", "sector-2");
const opened = new Date(fixedNow.getTime() - 60 * MINUTE);

function withSla(overrides: Parameters<typeof storedRequest>[0] = {}) {
  return createStore({
    actors: [ana, bia, caio],
    requests: [
      storedRequest({
        createdAt: opened,
        priority: "NORMAL",
        slaHoursSnapshot: 10,
        dueAt: new Date(opened.getTime() + 600 * MINUTE),
        ...overrides,
      }),
    ],
  });
}

function actAs(actor: StoredActor) {
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: actor.sectorId });
}

describe("priority change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recalculates the due date from the start of the period and records history and event (CA-SLA-04, 06)", async () => {
    const store = withSla();
    actAs(ana);

    await changeRequestPriority({ requestId, priority: "URGENT" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({
      priority: "URGENT",
      dueAt: new Date(opened.getTime() + 150 * MINUTE),
      updatedAt: fixedNow,
    });
    expect(store.priorityEvents).toEqual([
      { requestId, actorId: "ana", fromPriority: "NORMAL", toPriority: "URGENT", occurredAt: fixedNow },
    ]);
    expect(store.outbox).toEqual([
      expect.objectContaining({
        type: "request.priority_changed",
        payload: { fromPriority: "NORMAL", toPriority: "URGENT", actorId: "ana" },
      }),
    ]);
  });

  it("changes only the priority when the request has no SLA", async () => {
    const store = createStore({ actors: [ana], requests: [storedRequest()] });
    actAs(ana);

    await changeRequestPriority({ requestId, priority: "HIGH" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ priority: "HIGH", dueAt: null });
  });

  it("keeps the period start of a reopened request", () => {
    const reopenedAt = new Date("2026-11-05T10:00:00.000Z");
    const dueAt = new Date(reopenedAt.getTime() + 600 * MINUTE); // NORMAL, 10 h

    expect(dueAtAfterPriorityChange(dueAt, 10, "NORMAL", "LOW")).toEqual(new Date(reopenedAt.getTime() + 1200 * MINUTE));
    expect(dueAtAfterPriorityChange(null, null, "NORMAL", "LOW")).toBeNull();
  });

  it("respects the effective assignee and rejects an unchanged priority (CA-SLA-06)", async () => {
    const held = withSla({ assigneeId: "ana" });
    actAs(bia);
    await expect(
      changeRequestPriority({ requestId, priority: "HIGH" }, createInMemoryTransactionRunner(held)),
    ).rejects.toBeInstanceOf(ConflictError);

    const same = withSla();
    actAs(ana);
    await expect(
      changeRequestPriority({ requestId, priority: "NORMAL" }, createInMemoryTransactionRunner(same)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(same.priorityEvents).toHaveLength(0);
  });

  it("refuses finished requests and hides the request from other sectors", async () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      const store = withSla({ status, ...(status === "CANCELLED" ? { cancelledAt: fixedNow } : {}) });
      actAs(ana);
      await expect(
        changeRequestPriority({ requestId, priority: "HIGH" }, createInMemoryTransactionRunner(store)),
      ).rejects.toBeInstanceOf(ConflictError);
    }

    const store = withSla();
    actAs(caio);
    await expect(
      changeRequestPriority({ requestId, priority: "HIGH" }, createInMemoryTransactionRunner(store)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects unknown priorities and forged fields before any check", async () => {
    const store = withSla();
    for (const input of [
      { requestId, priority: "CRITICAL" },
      { requestId, priority: "HIGH", dueAt: "2026-01-01" },
    ]) {
      await expect(changeRequestPriority(input, createInMemoryTransactionRunner(store))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(authorization.requireStatusChangeActor).not.toHaveBeenCalled();
  });
});
