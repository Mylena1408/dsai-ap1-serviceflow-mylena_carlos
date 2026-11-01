import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";
import {
  createInMemoryTransactionRunner,
  createStore,
  requestId,
  storedRequest,
  type InMemoryRequestStore,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireStatusChangeActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { assumeRequest, releaseRequest, transferRequest } from "@/modules/requests/application/assignment";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-01-permissoes-configuraveis, section 5.3.3 (SF-090; CA-PER-07 and 08).

const attendant = (id: string, name: string): StoredActor => ({
  id,
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name,
  email: `${id}@example.test`,
});
const ana = attendant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "Ana");
const bia = attendant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", "Bia");
const caio = attendant("cccccccc-cccc-4ccc-8ccc-ccccccccccc3", "Caio");

function heldByAna(permissions: InMemoryRequestStore["permissions"] = {}) {
  return createStore({ actors: [ana, bia, caio], requests: [storedRequest({ assigneeId: ana.id })], permissions });
}

function actAs(actor: StoredActor) {
  authorization.requireStatusChangeActor.mockResolvedValue({ actorId: actor.id, sectorId: "sector-1" });
}

const runner = (store: InMemoryRequestStore) => createInMemoryTransactionRunner(store);

describe("queue supervision (SF-090)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a supervisor release a colleague's request, recorded as done by the supervisor (CA-PER-07, 08)", async () => {
    const store = heldByAna({ [bia.id]: ["QUEUE_SUPERVISION"] });
    actAs(bia);

    await releaseRequest({ requestId }, runner(store));

    expect(store.requests[0].assigneeId).toBeNull();
    expect(store.assignmentEvents).toEqual([
      expect.objectContaining({ actorId: bia.id, fromAssigneeId: ana.id, toAssigneeId: null }),
    ]);
    expect(store.outbox).toEqual([
      expect.objectContaining({ type: "request.assignment_changed", payload: { fromAssigneeId: ana.id, toAssigneeId: null, actorId: bia.id } }),
    ]);
  });

  it("lets a supervisor transfer a colleague's request to another attendant, never to the holder (CA-PER-07)", async () => {
    const store = heldByAna({ [bia.id]: ["QUEUE_SUPERVISION"] });
    actAs(bia);

    await expect(transferRequest({ requestId, assigneeId: ana.id }, runner(store))).rejects.toBeInstanceOf(ValidationError);
    await expect(transferRequest({ requestId, assigneeId: bia.id }, runner(store))).rejects.toBeInstanceOf(ValidationError);
    await transferRequest({ requestId, assigneeId: caio.id }, runner(store));

    expect(store.requests[0].assigneeId).toBe(caio.id);
  });

  it("keeps refusing colleagues without the permission (CA-PER-07)", async () => {
    const store = heldByAna({ [bia.id]: ["SECTOR_SERVICES"] });
    actAs(bia);

    await expect(releaseRequest({ requestId }, runner(store))).rejects.toBeInstanceOf(ConflictError);
    await expect(transferRequest({ requestId, assigneeId: caio.id }, runner(store))).rejects.toBeInstanceOf(ConflictError);
    expect(store.requests[0].assigneeId).toBe(ana.id);
  });

  it("does not let a supervisor assume a held request; assuming still needs it free", async () => {
    const store = heldByAna({ [bia.id]: ["QUEUE_SUPERVISION"] });
    actAs(bia);

    await expect(assumeRequest({ requestId }, runner(store))).rejects.toBeInstanceOf(ConflictError);
  });

  it("names who released a colleague's request in the timeline", () => {
    const at = new Date("2026-11-01T12:00:00.000Z");
    const request = {
      events: [],
      priorityEvents: [],
      stageEvents: [],
      approval: null,
      assignmentEvents: [
        { id: "a1", requestId, actorId: bia.id, fromAssigneeId: ana.id, toAssigneeId: null, occurredAt: at, actor: { id: bia.id, name: "Bia" }, fromAssignee: { id: ana.id, name: "Ana" }, toAssignee: null },
        { id: "a2", requestId, actorId: caio.id, fromAssigneeId: caio.id, toAssigneeId: null, occurredAt: at, actor: { id: caio.id, name: "Caio" }, fromAssignee: { id: caio.id, name: "Caio" }, toAssignee: null },
      ],
    } as unknown as RequestWithHistory;

    expect(buildTimeline(request).map(({ title }) => title)).toEqual([
      "Liberada por Bia (estava com Ana)",
      "Liberada por Caio",
    ]);
  });
});
