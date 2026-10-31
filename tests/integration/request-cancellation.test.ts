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

import { assumeRequest, cancelRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-10-31, section 5.4 (decision D3), SF-050.

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor | null) {
  session.getCurrentUser.mockResolvedValue(actor && { ...actor, email: `${actor.id}@example.test` });
}

async function scenario(status: "OPEN" | "IN_PROGRESS" = "OPEN") {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const stranger = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const request = await createDomainRequest({
    requesterId: owner.id,
    serviceId: service.id,
    sectorId: sector.id,
    status,
  });

  return { owner, stranger, ana, caio, admin, request };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const statusEvents = (requestId: string) =>
  prisma.requestStatusEvent.findMany({ where: { requestId }, orderBy: { occurredAt: "asc" } });

describe("request cancellation (SF-050)", () => {
  it("lets the owner cancel an open request and records time and reason (CA-ATR-06)", async () => {
    const { owner, request } = await scenario();
    actAs(owner);

    await cancelRequest({ requestId: request.id, note: "  Não preciso mais  " }, prisma);

    const after = await stored(request.id);
    const [event] = await statusEvents(request.id);
    expect(after).toMatchObject({ status: "CANCELLED", completedAt: null });
    expect(after.cancelledAt).toEqual(event.occurredAt);
    expect(after.updatedAt).toEqual(event.occurredAt);
    expect(event).toMatchObject({ actorId: owner.id, fromStatus: "OPEN", toStatus: "CANCELLED", note: "Não preciso mais" });
  });

  it("does not let the owner cancel a request in progress (CA-ATR-06)", async () => {
    const { owner, request } = await scenario("IN_PROGRESS");
    actAs(owner);

    await expect(cancelRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(stored(request.id)).resolves.toMatchObject({ status: "IN_PROGRESS", cancelledAt: null });
  });

  it("lets the attendant cancel in progress only with a reason (CA-ATR-07)", async () => {
    const { ana, request } = await scenario("IN_PROGRESS");
    actAs(ana);

    await expect(cancelRequest({ requestId: request.id, note: "" }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await cancelRequest({ requestId: request.id, note: "Duplicada" }, prisma);

    await expect(stored(request.id)).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(statusEvents(request.id)).resolves.toEqual([
      expect.objectContaining({ actorId: ana.id, fromStatus: "IN_PROGRESS", note: "Duplicada" }),
    ]);
  });

  it("keeps cancelled requests terminal (CA-ATR-08)", async () => {
    const { owner, ana, request } = await scenario();
    actAs(owner);
    await cancelRequest({ requestId: request.id }, prisma);

    actAs(ana);
    await expect(assumeRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(cancelRequest({ requestId: request.id, note: "De novo" }, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(statusEvents(request.id)).resolves.toHaveLength(1);
  });

  it("denies everyone else without revealing the request (CA-ATR-10)", async () => {
    const { stranger, caio, admin, owner, request } = await scenario();

    for (const actor of [stranger, caio, admin]) {
      actAs(actor);
      await expect(cancelRequest({ requestId: request.id, note: "x" }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    }
    for (const actor of [{ ...owner, isActive: false }, null]) {
      actAs(actor);
      await expect(cancelRequest({ requestId: request.id }, prisma)).rejects.toBeInstanceOf(AuthenticationError);
    }
    await expect(stored(request.id)).resolves.toMatchObject({ status: "OPEN", cancelledAt: null });
  });
});
