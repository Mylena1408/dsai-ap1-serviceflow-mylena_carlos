import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, NotFoundError } from "@/server/errors";
import {
  activeService,
  createInMemoryQueryRepository,
  createStore,
  requestId,
  storedRequest,
  type StoredActor,
} from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", async () => {
  const policy = await vi.importActual<typeof import("@/server/authorization/policy")>(
    "@/server/authorization/policy",
  );
  return { ...authorization, assertRole: policy.assertRole };
});

import {
  getAttendantRequest,
  getRequesterRequest,
  listAttendantQueue,
  listRequesterRequests,
} from "@/modules/requests/application/request-queries";

const requester: StoredActor = {
  id: "requester-1",
  role: "REQUESTER",
  sectorId: null,
  isActive: true,
  name: "Requester",
  email: "requester@example.test",
};
const attendant: StoredActor = {
  id: "attendant-1",
  role: "ATTENDANT",
  sectorId: "sector-1",
  isActive: true,
  name: "Attendant",
  email: "attendant@example.test",
};
const otherRequestId = "33333333-3333-4333-8333-333333333333";

function seededRepository() {
  return createInMemoryQueryRepository(
    createStore({
      actors: [requester, attendant],
      services: [activeService()],
      requests: [
        storedRequest(),
        storedRequest({ id: otherRequestId, requesterId: "requester-2", sectorId: "sector-2" }),
      ],
    }),
  );
}

describe("request query use cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists and reads only the requester's own requests", async () => {
    authorization.requireCurrentActor.mockResolvedValue(requester);
    const repository = seededRepository();

    expect((await listRequesterRequests(repository)).map(({ id }) => id)).toEqual([requestId]);
    expect((await getRequesterRequest(requestId, repository)).id).toBe(requestId);
    await expect(getRequesterRequest(otherRequestId, repository)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("lists and reads only requests of the attendant's sector", async () => {
    authorization.requireCurrentActor.mockResolvedValue(attendant);
    const repository = seededRepository();

    expect((await listAttendantQueue(repository)).map(({ id }) => id)).toEqual([requestId]);
    expect((await getAttendantRequest(requestId, repository)).id).toBe(requestId);
    await expect(getAttendantRequest(otherRequestId, repository)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("denies the wrong role and an attendant without sector", async () => {
    const repository = seededRepository();

    authorization.requireCurrentActor.mockResolvedValue(attendant);
    await expect(listRequesterRequests(repository)).rejects.toBeInstanceOf(AuthorizationError);

    authorization.requireCurrentActor.mockResolvedValue({ ...attendant, sectorId: null });
    await expect(listAttendantQueue(repository)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAttendantRequest(requestId, repository)).rejects.toBeInstanceOf(NotFoundError);
  });
});
