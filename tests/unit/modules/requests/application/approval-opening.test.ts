import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/server/errors";
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
}));
vi.mock("@/server/authorization", () => authorization);

import { createRequest } from "@/modules/requests/application/create-request";
import { transitionRequestStatus } from "@/modules/requests/application/transition-request-status";

// SPEC 2026-11-01-aprovacoes, sections 5.2, 5.3 and 5.5 (SF-083).

const HOUR = 60 * 60 * 1000;
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

describe("approval at opening and start (SF-083)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireRequestCreator.mockResolvedValue(requester);
    authorization.requireStatusChangeActor.mockResolvedValue({ actorId: attendant.id, sectorId: "sector-1" });
  });

  it("opens a request of a service with approval as pending, keeping the SLA hours without a due date (CA-APR-04, 07)", async () => {
    const store = createStore({ actors: [requester], services: [activeService({ requiresApproval: true, slaHours: 10 })] });

    await createRequest({ serviceId, description: "Notebook novo" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ approvalState: "PENDING", slaHoursSnapshot: 10, dueAt: null });
  });

  it("opens a request of a service without approval exactly as before (CA-APR-01)", async () => {
    const store = createStore({ actors: [requester], services: [activeService({ slaHours: 10 })] });

    await createRequest({ serviceId, description: "Monitor" }, createInMemoryTransactionRunner(store));

    expect(store.requests[0]).toMatchObject({ approvalState: null, slaHoursSnapshot: 10 });
    expect(store.requests[0].dueAt?.getTime()).toBe(fixedNow.getTime() + 10 * HOUR);
  });

  it("refuses to start while the approval is pending and starts once approved (CA-APR-05)", async () => {
    const pending = createStore({ actors: [attendant], requests: [storedRequest({ approvalState: "PENDING" })] });

    await expect(
      transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, createInMemoryTransactionRunner(pending)),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(pending.requests[0].status).toBe("OPEN");
    expect(pending.events).toHaveLength(0);

    const approved = createStore({ actors: [attendant], requests: [storedRequest({ approvalState: "APPROVED" })] });
    await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, createInMemoryTransactionRunner(approved));
    expect(approved.requests[0].status).toBe("IN_PROGRESS");
  });
});
