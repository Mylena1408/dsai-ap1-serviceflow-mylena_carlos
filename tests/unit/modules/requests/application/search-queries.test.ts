import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/errors";
import { assertRole } from "@/server/authorization/policy";
import { createInMemoryQueryRepository, createStore } from "../in-memory-requests";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn(), assertRole: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { searchAttendantQueue, searchRequesterRequests } from "@/modules/requests/application/request-queries";

// SPEC 2026-10-31-busca-filtros-paginacao (SF-058): the scope always comes from the session.

const requester = { id: "requester-1", role: "REQUESTER", sectorId: null, isActive: true };
const attendant = { id: "attendant-1", role: "ATTENDANT", sectorId: "sector-1", isActive: true };

describe("search use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.assertRole.mockImplementation(assertRole);
  });

  it("scopes the requester search to the session, ignoring forged parameters", async () => {
    authorization.requireCurrentActor.mockResolvedValue(requester);
    const repository = createInMemoryQueryRepository(createStore());
    const search = vi.spyOn(repository, "search");

    const result = await searchRequesterRequests(
      { q: "cadeira", requesterId: "someone-else", sectorId: "x", assignee: "mine" },
      repository,
    );

    expect(search).toHaveBeenCalledWith(
      { requesterId: "requester-1" },
      expect.objectContaining({ term: "cadeira", assignee: "all", order: "newest" }),
      "requester-1",
    );
    expect(result.criteria.term).toBe("cadeira");
  });

  it("scopes the queue to the attendant's current sector", async () => {
    authorization.requireCurrentActor.mockResolvedValue(attendant);
    const repository = createInMemoryQueryRepository(createStore());
    const search = vi.spyOn(repository, "search");

    await searchAttendantQueue({ assignee: "mine", sectorId: "sector-2" }, repository);

    expect(search).toHaveBeenCalledWith(
      { sectorId: "sector-1" },
      expect.objectContaining({ assignee: "mine", order: "oldest" }),
      "attendant-1",
    );
  });

  it("denies other roles, attendants without sector and invalid criteria before querying", async () => {
    const repository = createInMemoryQueryRepository(createStore());
    const search = vi.spyOn(repository, "search");

    authorization.requireCurrentActor.mockResolvedValue(attendant);
    await expect(searchRequesterRequests({}, repository)).rejects.toBeInstanceOf(AuthorizationError);
    authorization.requireCurrentActor.mockResolvedValue({ ...attendant, sectorId: null });
    await expect(searchAttendantQueue({}, repository)).rejects.toBeInstanceOf(NotFoundError);
    authorization.requireCurrentActor.mockResolvedValue(requester);
    await expect(searchRequesterRequests({ q: "a" }, repository)).rejects.toBeInstanceOf(ValidationError);
    await expect(searchRequesterRequests(null, repository)).resolves.toMatchObject({ total: 0 });

    expect(search).toHaveBeenCalledTimes(1);
  });
});
