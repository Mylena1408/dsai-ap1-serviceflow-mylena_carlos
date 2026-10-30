import { vi, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../fixtures";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "../domain-fixtures";

const session = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("../fixtures");
  return { prisma };
});

import {
  createSector,
  setSectorActive,
} from "@/modules/sectors";
import {
  getPublishedService,
  listPublishedServices,
} from "@/modules/services";
import {
  createRequest,
  getAttendantRequest,
  getRequesterRequest,
  listAttendantQueue,
  listRequesterRequests,
  transitionRequestStatus,
} from "@/modules/requests";

type CurrentActor = {
  id: string;
  name: string;
  email: string;
  role: Role;
  sectorId: string | null;
  isActive: boolean;
};

function useActor(actor: CurrentActor | null) {
  session.getCurrentUser.mockResolvedValue(actor);
}

async function createServiceContext() {
  const category = await createDomainCategory();
  const sector = await createDomainSector();
  const service = await createDomainService({
    categoryId: category.id,
    sectorId: sector.id,
  });

  return { category, sector, service };
}

describe("server authorization and validation matrix", () => {
  it("enforces profile-specific operations at the domain boundary", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    const requester = await createDomainUser({ role: "REQUESTER" });
    const sector = await createDomainSector();
    const attendant = await createDomainUser({
      role: "ATTENDANT",
      sectorId: sector.id,
    });
    const { service } = await createServiceContext();

    useActor({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      sectorId: admin.sectorId,
      isActive: admin.isActive,
    });
    await expect(createSector({ name: "Authorized admin sector" }, prisma))
      .resolves.toMatchObject({ name: "Authorized admin sector" });
    await expect(listPublishedServices(prisma)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      createRequest({ serviceId: service.id, description: "Denied" }, prisma),
    ).rejects.toBeInstanceOf(AuthorizationError);

    useActor({
      id: requester.id,
      name: requester.name,
      email: requester.email,
      role: requester.role,
      sectorId: requester.sectorId,
      isActive: requester.isActive,
    });
    await expect(listPublishedServices(prisma)).resolves.toHaveLength(1);
    await expect(createSector({ name: "Denied requester sector" }, prisma))
      .rejects.toBeInstanceOf(AuthorizationError);
    const created = await createRequest(
      { serviceId: service.id, description: "Requester-owned" },
      prisma,
    );
    await expect(getRequesterRequest(created.id, prisma)).resolves.toMatchObject({
      requesterId: requester.id,
    });

    useActor({
      id: attendant.id,
      name: attendant.name,
      email: attendant.email,
      role: attendant.role,
      sectorId: attendant.sectorId,
      isActive: attendant.isActive,
    });
    await expect(listAttendantQueue(prisma)).resolves.toHaveLength(0);
    await expect(listRequesterRequests(prisma)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      getPublishedService(service.id, prisma),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("blocks inactive actors, including an actor deactivated after the session check", async () => {
    const requester = await createDomainUser({ role: "REQUESTER" });
    const { service } = await createServiceContext();
    useActor({
      id: requester.id,
      name: requester.name,
      email: requester.email,
      role: requester.role,
      sectorId: requester.sectorId,
      isActive: true,
    });
    await prisma.user.update({
      where: { id: requester.id },
      data: { isActive: false },
    });

    await expect(
      createRequest({ serviceId: service.id, description: "Must not persist" }, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(prisma.request.count()).resolves.toBe(0);
    await expect(prisma.requestStatusEvent.count()).resolves.toBe(0);

    useActor({
      id: requester.id,
      name: requester.name,
      email: requester.email,
      role: requester.role,
      sectorId: requester.sectorId,
      isActive: false,
    });
    await expect(listPublishedServices(prisma)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("hides requests across ownership and sector boundaries for direct-ID access", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    const anotherRequester = await createDomainUser({ role: "REQUESTER" });
    const sectorA = await createDomainSector();
    const sectorB = await createDomainSector();
    const attendantB = await createDomainUser({
      role: "ATTENDANT",
      sectorId: sectorB.id,
    });
    const { service } = await createServiceContext();
    const owned = await createDomainRequest({
      requesterId: owner.id,
      serviceId: service.id,
      sectorId: sectorA.id,
    });

    useActor({
      id: anotherRequester.id,
      name: anotherRequester.name,
      email: anotherRequester.email,
      role: anotherRequester.role,
      sectorId: null,
      isActive: true,
    });
    await expect(getRequesterRequest(owned.id, prisma)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getRequesterRequest("00000000-0000-4000-8000-000000009999", prisma),
    ).rejects.toBeInstanceOf(NotFoundError);

    useActor({
      id: attendantB.id,
      name: attendantB.name,
      email: attendantB.email,
      role: attendantB.role,
      sectorId: sectorB.id,
      isActive: true,
    });
    await expect(getAttendantRequest(owned.id, prisma)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      transitionRequestStatus(
        { requestId: owned.id, toStatus: "IN_PROGRESS" },
        prisma,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects forged protected fields, malformed identifiers and invalid activation values", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    const requester = await createDomainUser({ role: "REQUESTER" });
    const { service, sector } = await createServiceContext();

    useActor({
      id: requester.id,
      name: requester.name,
      email: requester.email,
      role: requester.role,
      sectorId: null,
      isActive: true,
    });
    await expect(
      createRequest(
        {
          serviceId: service.id,
          description: "Forged",
          requesterId: admin.id,
          status: "COMPLETED",
          sectorId: sector.id,
          serviceNameSnapshot: "Forged snapshot",
          createdAt: new Date(),
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transitionRequestStatus(
        {
          requestId: "00000000-0000-4000-8000-000000009998",
          toStatus: "IN_PROGRESS",
          actorId: admin.id,
          status: "COMPLETED",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    useActor({
      id: requester.id,
      name: requester.name,
      email: requester.email,
      role: requester.role,
      sectorId: null,
      isActive: true,
    });
    await expect(
      getPublishedService("not-a-uuid", prisma),
    ).rejects.toBeInstanceOf(ValidationError);

    useActor({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      sectorId: null,
      isActive: true,
    });
    await expect(setSectorActive(sector.id, "yes", prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      setSectorActive("not-a-uuid", false, prisma),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(prisma.request.count()).resolves.toBe(0);
  });
});
