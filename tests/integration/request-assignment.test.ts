import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
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

import {
  assumeRequest,
  getAttendantRequest,
  listTransferCandidates,
  releaseRequest,
  transferRequest,
} from "@/modules/requests";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor | null) {
  session.getCurrentUser.mockResolvedValue(actor && { ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const request = await createDomainRequest({
    requesterId: requester.id,
    serviceId: service.id,
    sectorId: sector.id,
  });

  return { sector, otherSector, requester, ana, bia, caio, admin, request };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const events = (requestId: string) =>
  prisma.requestAssignmentEvent.findMany({ where: { requestId }, orderBy: { occurredAt: "asc" } });

describe("request assignment (SF-048)", () => {
  it("assumes, transfers and releases with events and database time (CA-ATR-01, 03, 04)", async () => {
    const { ana, bia, request } = await scenario();

    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ assigneeId: ana.id, status: "OPEN" });

    await expect(listTransferCandidates(request.id, prisma)).resolves.toEqual([{ id: bia.id, name: bia.name }]);
    await transferRequest({ requestId: request.id, assigneeId: bia.id }, prisma);

    actAs(bia);
    await releaseRequest({ requestId: request.id }, prisma);

    const after = await stored(request.id);
    const history = await events(request.id);
    expect(after.assigneeId).toBeNull();
    expect(history.map(({ actorId, fromAssigneeId, toAssigneeId }) => [actorId, fromAssigneeId, toAssigneeId])).toEqual([
      [ana.id, null, ana.id],
      [ana.id, ana.id, bia.id],
      [bia.id, bia.id, null],
    ]);
    expect(after.updatedAt).toEqual(history.at(-1)?.occurredAt);

    const detail = await getAttendantRequest(request.id, prisma);
    expect(detail.assignee).toBeNull();
  });

  it("rejects assuming a held request but allows it after the holder leaves the sector (CA-ATR-02)", async () => {
    const { ana, bia, otherSector, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);

    actAs(bia);
    await expect(assumeRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(events(request.id)).resolves.toHaveLength(1);

    await prisma.user.update({ where: { id: ana.id }, data: { sectorId: otherSector.id } });
    await assumeRequest({ requestId: request.id }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ assigneeId: bia.id });
  });

  it("validates the transfer target against the database (CA-ATR-03)", async () => {
    const { ana, bia, caio, admin, requester, request } = await scenario();
    await prisma.user.update({ where: { id: bia.id }, data: { isActive: false } });
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);

    for (const target of [ana.id, bia.id, caio.id, admin.id, requester.id, "00000000-0000-4000-8000-0000000000aa"]) {
      await expect(
        transferRequest({ requestId: request.id, assigneeId: target }, prisma),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(stored(request.id)).resolves.toMatchObject({ assigneeId: ana.id });
  });

  it("denies everyone outside the request's sector without revealing it (CA-ATR-10)", async () => {
    const { caio, admin, requester, ana, request } = await scenario();

    for (const actor of [caio, admin, requester]) {
      actAs(actor);
      await expect(assumeRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    }
    for (const actor of [{ ...ana, isActive: false }, null]) {
      actAs(actor);
      await expect(assumeRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(AuthenticationError);
    }
    await expect(stored(request.id)).resolves.toMatchObject({ assigneeId: null });
    await expect(events(request.id)).resolves.toHaveLength(0);
  });

  it("accepts exactly one of two concurrent assumptions (CA-ATR-11)", async () => {
    const { ana, bia, request } = await scenario();
    const assumeAs = async (actor: Actor) => {
      session.getCurrentUser.mockResolvedValueOnce({ ...actor, email: `${actor.id}@example.test` });
      return assumeRequest({ requestId: request.id }, prisma);
    };

    const results = await Promise.allSettled([assumeAs(ana), assumeAs(bia)]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ConflictError);
    await expect(events(request.id)).resolves.toHaveLength(1);
    const winner = (await stored(request.id)).assigneeId;
    expect([ana.id, bia.id]).toContain(winner);
  });

  it("refuses assignment on completed requests", async () => {
    const { ana, request } = await scenario();
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    actAs(ana);

    await expect(assumeRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(ConflictError);
  });
});
