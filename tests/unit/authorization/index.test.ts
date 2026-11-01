import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError } from "@/server/errors";
import { getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  requireConfigurationAdministrator,
  requireCurrentActor,
  requirePublishedCatalogReader,
  requireRequestCreator,
  requireRequestReader,
  requireStatusChangeActor,
} from "@/server/authorization";

vi.mock("@/server/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  prisma: {
    request: {
      findUnique: vi.fn(),
    },
  },
}));

const currentUser = vi.mocked(getCurrentUser);
const findRequest = vi.mocked(prisma.request.findUnique);
const requestId = "00000000-0000-4000-8000-000000000021";

function persistedRequest(requesterId: string, sectorId: string) {
  const timestamp = new Date();

  return {
    id: "request-id",
    requesterId,
    serviceId: "service-id",
    sectorId,
    serviceNameSnapshot: "Service",
    serviceDescriptionSnapshot: "Description",
    categoryIdSnapshot: "category-id",
    categoryNameSnapshot: "Category",
    sectorNameSnapshot: "Sector",
    description: "Request description",
    status: "OPEN" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    assigneeId: null,
    cancelledAt: null,
    priority: "NORMAL" as const,
    slaHoursSnapshot: null,
    dueAt: null,
    dueSoonAt: null,
    stageNamesSnapshot: [],
    stageIndex: null,
    slaWarningNotifiedAt: null,
    slaBreachNotifiedAt: null,
    completedLate: null,
  };
}

describe("session-bound authorization helpers", () => {
  beforeEach(() => {
    currentUser.mockReset();
    findRequest.mockReset();
  });

  it("requires the current active server session", async () => {
    currentUser.mockResolvedValue(null);

    await expect(requireCurrentActor()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("derives administrator and requester roles from the server session", async () => {
    currentUser.mockResolvedValue({
      id: "current-id",
      name: "Current User",
      email: "current@example.test",
      role: "ADMIN",
      sectorId: null,
      isActive: true,
    });
    await expect(requireConfigurationAdministrator()).resolves.toMatchObject({
      id: "current-id",
      role: "ADMIN",
    });
    await expect(requirePublishedCatalogReader()).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    currentUser.mockResolvedValue({
      id: "requester-id",
      name: "Requester",
      email: "requester@example.test",
      role: "REQUESTER",
      sectorId: null,
      isActive: true,
    });
    await expect(requireRequestCreator()).resolves.toMatchObject({
      id: "requester-id",
      role: "REQUESTER",
    });
    await expect(requirePublishedCatalogReader()).resolves.toMatchObject({
      id: "requester-id",
      role: "REQUESTER",
    });
  });

  it("derives status actor identifiers from session, not the request", async () => {
    currentUser.mockResolvedValue({
      id: "attendant-id",
      name: "Attendant",
      email: "attendant@example.test",
      role: "ATTENDANT",
      sectorId: "sector-current",
      isActive: true,
    });
    findRequest.mockResolvedValue(
      persistedRequest("client-controlled-requester", "sector-current"),
    );

    await expect(
      requireStatusChangeActor(requestId),
    ).resolves.toEqual({
      actorId: "attendant-id",
      sectorId: "sector-current",
    });
    expect(findRequest).toHaveBeenCalledWith({
      where: { id: requestId },
      select: { requesterId: true, sectorId: true },
    });
  });

  it("does not expose request existence to another requester or an administrator", async () => {
    currentUser.mockResolvedValue({
      id: "other-requester",
      name: "Other",
      email: "other@example.test",
      role: "REQUESTER",
      sectorId: null,
      isActive: true,
    });
    findRequest.mockResolvedValue(persistedRequest("owner-id", "sector-1"));

    await expect(
      requireRequestReader("00000000-0000-4000-8000-000000000022"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    currentUser.mockResolvedValue({
      id: "admin-id",
      name: "Admin",
      email: "admin@example.test",
      role: "ADMIN",
      sectorId: null,
      isActive: true,
    });

    await expect(
      requireRequestReader("00000000-0000-4000-8000-000000000023"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("hides missing requests with the same not-found response", async () => {
    currentUser.mockResolvedValue({
      id: "requester-id",
      name: "Requester",
      email: "requester@example.test",
      role: "REQUESTER",
      sectorId: null,
      isActive: true,
    });
    findRequest.mockResolvedValue(null);

    await expect(
      requireRequestReader("00000000-0000-4000-8000-000000000024"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
