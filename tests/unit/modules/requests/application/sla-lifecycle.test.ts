import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeService,
  createInMemoryTransactionRunner,
  createStore,
  fixedNow,
  requestId,
  serviceId,
  storedRequest,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({
  requireRequestCreator: vi.fn(),
  requireStatusChangeActor: vi.fn(),
  requireCurrentActor: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import { createRequest } from "@/modules/requests/application/create-request";
import { reopenRequest } from "@/modules/requests/application/lifecycle-actions";
import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";

// SPEC 2026-11-01-sla-prioridades, sections 5.1 to 5.3 (SF-066).

const MINUTE = 60_000;
const requester: StoredActor = {
  id: "requester-1",
  role: "REQUESTER",
  sectorId: null,
  isActive: true,
  name: "Rita",
  email: "rita@example.test",
};
const attendant: StoredActor = {
  id: "attendant-1",
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name: "Ana",
  email: "ana@example.test",
};

describe("SLA through the request lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireRequestCreator.mockResolvedValue(requester);
    authorization.requireCurrentActor.mockResolvedValue(requester);
    authorization.requireStatusChangeActor.mockResolvedValue({ actorId: attendant.id, sectorId: "sector-1" });
  });

  it("snapshots the default priority and SLA of the service on opening (CA-SLA-03)", async () => {
    const store = createStore({
      actors: [requester],
      services: [activeService({ defaultPriority: "HIGH", slaHours: 10 })],
    });

    await createRequest({ serviceId, description: "Urgente-ish" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({
      priority: "HIGH",
      slaHoursSnapshot: 10,
      dueAt: new Date(fixedNow.getTime() + 300 * MINUTE),
    });
  });

  it("keeps services without SLA exactly as before (CA-SLA-01)", async () => {
    const store = createStore({ actors: [requester], services: [activeService()] });

    await createRequest({ serviceId, description: "Sem prazo" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ priority: "NORMAL", slaHoursSnapshot: null, dueAt: null, completedLate: null });
  });

  it("records whether the completion met the due date (CA-SLA-08)", async () => {
    for (const [dueAt, late] of [
      [new Date(fixedNow.getTime() + MINUTE), false],
      [fixedNow, false],
      [new Date(fixedNow.getTime() - 1), true],
    ] as const) {
      const store = createStore({
        actors: [attendant],
        requests: [storedRequest({ status: "IN_PROGRESS", slaHoursSnapshot: 4, dueAt })],
      });

      await transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, createInMemoryTransactionRunner(store));

      expect(store.requests[0]).toMatchObject({ status: "COMPLETED", completedLate: late });
    }

    const noSla = createStore({ actors: [attendant], requests: [storedRequest({ status: "IN_PROGRESS" })] });
    await transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, createInMemoryTransactionRunner(noSla));
    expect(noSla.requests[0].completedLate).toBeNull();
  });

  it("restarts the due date from the reopening with the current priority (CA-SLA-04)", async () => {
    const store = createStore({
      actors: [requester],
      requests: [
        storedRequest({
          status: "COMPLETED",
          completedAt: new Date(fixedNow.getTime() - 60 * MINUTE),
          priority: "URGENT",
          slaHoursSnapshot: 8,
          dueAt: new Date(fixedNow.getTime() - 120 * MINUTE),
          completedLate: true,
        }),
      ],
    });

    await reopenRequest({ requestId, note: "Voltou" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({
      status: "OPEN",
      completedAt: null,
      completedLate: null,
      dueAt: new Date(fixedNow.getTime() + 120 * MINUTE),
    });
  });
});
