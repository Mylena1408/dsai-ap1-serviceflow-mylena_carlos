import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { assumeRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-10-31, section 5.3 (decision D2), SF-049.

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });

  return { otherSector, ana, bia, request };
}

const statusOf = async (id: string) => (await prisma.request.findUniqueOrThrow({ where: { id } })).status;

describe("status changes with an assignee (CA-ATR-05)", () => {
  it("keeps the old behavior without assignee: any attendant of the sector starts and completes", async () => {
    const { ana, bia, request } = await scenario();

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    actAs(bia);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);

    await expect(statusOf(request.id)).resolves.toBe("COMPLETED");
  });

  it("reserves start and completion to the effective assignee", async () => {
    const { ana, bia, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);

    actAs(bia);
    await expect(
      transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(statusOf(request.id)).resolves.toBe("OPEN");
    await expect(prisma.requestStatusEvent.count({ where: { requestId: request.id } })).resolves.toBe(0);

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    actAs(bia);
    await expect(
      transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "COMPLETED" }, prisma);

    await expect(statusOf(request.id)).resolves.toBe("COMPLETED");
  });

  it("frees the request when the assignee leaves the sector", async () => {
    const { ana, bia, otherSector, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await prisma.user.update({ where: { id: ana.id }, data: { sectorId: otherSector.id } });

    actAs(bia);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);

    await expect(statusOf(request.id)).resolves.toBe("IN_PROGRESS");
  });
});
