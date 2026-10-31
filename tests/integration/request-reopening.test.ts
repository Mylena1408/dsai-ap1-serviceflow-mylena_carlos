import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
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

import { reopenRequest } from "@/modules/requests";

// SPEC 2026-10-31, section 5.5 (decisions D4 and D5), SF-051.

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

/** A completed request whose completedAt is `interval` before the database clock. */
async function completedRequest(interval: string) {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const owner = await createDomainUser({ role: "REQUESTER" });
  const stranger = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const request = await createDomainRequest({
    requesterId: owner.id,
    serviceId: service.id,
    sectorId: sector.id,
    status: "COMPLETED",
  });
  await prisma.$executeRaw`
    UPDATE "Request"
    SET "completedAt" = now() - ${interval}::interval, "assigneeId" = ${ana.id}::uuid
    WHERE "id" = ${request.id}::uuid
  `;

  return { owner, stranger, ana, request };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });

describe("request reopening (SF-051)", () => {
  it("reopens within 7 days with the assignee kept and the reason recorded (CA-ATR-09)", async () => {
    const { owner, ana, request } = await completedRequest("6 days 23 hours");
    actAs(owner);

    await reopenRequest({ requestId: request.id, note: "A impressora parou de novo" }, prisma);

    const after = await stored(request.id);
    const event = await prisma.requestStatusEvent.findFirstOrThrow({ where: { requestId: request.id, toStatus: "OPEN", fromStatus: "COMPLETED" } });
    expect(after).toMatchObject({ status: "OPEN", completedAt: null, assigneeId: ana.id });
    expect(after.updatedAt).toEqual(event.occurredAt);
    expect(event).toMatchObject({ actorId: owner.id, note: "A impressora parou de novo" });
  });

  it("refuses after 7 days, using the database clock (CA-ATR-09)", async () => {
    const { owner, request } = await completedRequest("7 days 1 minute");
    actAs(owner);

    await expect(reopenRequest({ requestId: request.id, note: "Voltou" }, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(stored(request.id)).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("requires a reason and is denied to other users (CA-ATR-10)", async () => {
    const { owner, stranger, ana, request } = await completedRequest("1 hour");

    actAs(owner);
    await expect(reopenRequest({ requestId: request.id, note: " " }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    for (const actor of [stranger, ana]) {
      actAs(actor);
      await expect(reopenRequest({ requestId: request.id, note: "x" }, prisma)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await expect(stored(request.id)).resolves.toMatchObject({ status: "COMPLETED" });
  });
});
