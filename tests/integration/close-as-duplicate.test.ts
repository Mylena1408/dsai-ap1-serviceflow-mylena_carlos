import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { closeAsDuplicate, getFollowedRequest, linkRequests } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, part F (SF-217; CA-DUP-01 to 03; decisions I17 and I18).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const code = (id: string) => id.slice(0, 8).toUpperCase();

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const lia = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const original = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  const duplicate = await createDomainRequest({ requesterId: lia.id, serviceId: service.id, sectorId: sector.id });
  return { rita, lia, ana, caio, original, duplicate };
}

describe("closing as a duplicate (8.3)", () => {
  it("cancels the duplicate with the reason, marks both histories and makes its requester follow the original", async () => {
    const { lia, ana, original, duplicate } = await scenario();
    actAs(ana);
    await linkRequests({ requestId: duplicate.id, code: code(original.id), kind: "DUPLICATE_OF" }, prisma);
    await closeAsDuplicate({ requestId: duplicate.id, note: "Mesmo pedido." }, prisma);

    await expect(prisma.request.findUniqueOrThrow({ where: { id: duplicate.id } })).resolves.toMatchObject({ status: "CANCELLED" });
    const event = await prisma.requestStatusEvent.findFirstOrThrow({ where: { requestId: duplicate.id, toStatus: "CANCELLED" } });
    expect(event).toMatchObject({ reason: "DUPLICATE", note: `Duplicada de #${code(original.id)}. Mesmo pedido.`, actorId: ana.id });
    expect(await prisma.requestLinkEvent.count({ where: { fromRequestId: duplicate.id, toRequestId: original.id, action: "CLOSED_AS_DUPLICATE" } })).toBe(1);
    expect(await prisma.requestFollower.findMany({ where: { requestId: original.id }, select: { userId: true, addedById: true } })).toEqual([
      { userId: lia.id, addedById: ana.id },
    ]);

    // The duplicate's requester reads the original as a colleague who follows (CA-DUP-03).
    actAs(lia);
    await expect(getFollowedRequest(original.id, prisma)).resolves.toMatchObject({ id: original.id });
  });

  it("the same requester on both: closed, without following their own request", async () => {
    const { rita, ana, original } = await scenario();
    const own = await createDomainRequest({ requesterId: rita.id, serviceId: original.serviceId!, sectorId: original.sectorId });
    actAs(ana);
    await linkRequests({ requestId: own.id, code: code(original.id), kind: "DUPLICATE_OF" }, prisma);
    await closeAsDuplicate({ requestId: own.id, note: "Repetido." }, prisma);
    expect(await prisma.requestFollower.count({ where: { requestId: original.id } })).toBe(0);
  });

  it("refuses without the link, with a cancelled original, without a note, and outside the sector's attendants", async () => {
    const { lia, ana, caio, original, duplicate } = await scenario();
    actAs(ana);
    await expect(closeAsDuplicate({ requestId: duplicate.id, note: "Sem vínculo." }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await linkRequests({ requestId: duplicate.id, code: code(original.id), kind: "DUPLICATE_OF" }, prisma);
    await expect(closeAsDuplicate({ requestId: duplicate.id }, prisma)).rejects.toBeInstanceOf(ValidationError);
    for (const actor of [caio, lia]) {
      actAs(actor);
      await expect(closeAsDuplicate({ requestId: duplicate.id, note: "Tentativa." }, prisma)).rejects.toBeInstanceOf(NotFoundError);
    }
    await prisma.request.update({ where: { id: original.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    actAs(ana);
    await expect(closeAsDuplicate({ requestId: duplicate.id, note: "Original cancelada." }, prisma)).rejects.toBeInstanceOf(ConflictError);
    // Nothing was written by the refusals.
    await expect(prisma.request.findUniqueOrThrow({ where: { id: duplicate.id } })).resolves.toMatchObject({ status: "OPEN" });
    expect(await prisma.requestStatusEvent.count({ where: { reason: "DUPLICATE" } })).toBe(0);
  });

  it("the reason exists only on cancellations (8.4)", async () => {
    const { ana, original } = await scenario();
    await expect(
      prisma.requestStatusEvent.create({ data: { requestId: original.id, actorId: ana.id, fromStatus: "OPEN", toStatus: "IN_PROGRESS", reason: "DUPLICATE" } }),
    ).rejects.toThrow(/RequestStatusEvent_reason_check/);
  });
});
