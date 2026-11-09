import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { linkRequests, listPossibleDuplicates } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.5 item 1 (SF-232; decision J9; CA-DUP-04, suggestions).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const DAY = 24 * 60 * 60 * 1000;
const code = (id: string) => id.slice(0, 8).toUpperCase();

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const chair = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const desk = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const lia = await createDomainUser({ role: "REQUESTER" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const base = await createDomainRequest({ requesterId: lia.id, serviceId: chair.id, sectorId: sector.id });
  const opened = async (days: number, changes: { requesterId?: string; serviceId?: string; sectorId?: string; status?: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } = {}) => {
    const request = await createDomainRequest({
      requesterId: changes.requesterId ?? lia.id,
      serviceId: changes.serviceId ?? chair.id,
      sectorId: changes.sectorId ?? sector.id,
    });
    const status = changes.status ?? "OPEN";
    return prisma.request.update({
      where: { id: request.id },
      data: {
        createdAt: new Date(base.createdAt.getTime() + days * DAY),
        status,
        // A cancelled request carries when (a database check); a completed one, when it ended.
        ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
        ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
    });
  };
  return { sector, other, chair, desk, lia, rita, ana, caio, base, opened };
}

describe("possible duplicates on the queue's detail (13.5 item 1)", () => {
  it("lists the requester's open requests of the same service within 7 days, closest first", async () => {
    const { desk, rita, ana, base, opened } = await scenario();
    const near = await opened(1);
    const before = await opened(-3, { status: "IN_PROGRESS" });
    // Left out: beyond the window, another service, another requester, the closed ones.
    await opened(8);
    await opened(1, { serviceId: desk.id });
    await opened(1, { requesterId: rita.id });
    await opened(1, { status: "COMPLETED" });
    await opened(1, { status: "CANCELLED" });

    actAs(ana);
    const suggestions = await listPossibleDuplicates(base.id, prisma);
    expect(suggestions.map(({ id }) => id)).toEqual([near.id, before.id]);
    expect(suggestions[1]).toMatchObject({ status: "IN_PROGRESS", serviceName: base.serviceNameSnapshot, readable: true });
  });

  it("drops a request once it is linked to this one", async () => {
    const { ana, base, opened } = await scenario();
    const near = await opened(1);
    actAs(ana);
    await linkRequests({ requestId: near.id, code: code(base.id), kind: "DUPLICATE_OF" }, prisma);
    await expect(listPossibleDuplicates(base.id, prisma)).resolves.toEqual([]);
  });

  it("shows one in another sector without opening it", async () => {
    const { other, ana, base, opened } = await scenario();
    const elsewhere = await opened(1, { sectorId: other.id });
    actAs(ana);
    await expect(listPossibleDuplicates(base.id, prisma)).resolves.toEqual([expect.objectContaining({ id: elsewhere.id, readable: false })]);
  });

  it("only for the team: the requester gets none; whoever cannot read the request is told it does not exist", async () => {
    const { lia, caio, base, opened } = await scenario();
    await opened(1);
    actAs(lia);
    await expect(listPossibleDuplicates(base.id, prisma)).resolves.toEqual([]);
    actAs(caio);
    await expect(listPossibleDuplicates(base.id, prisma)).rejects.toBeInstanceOf(NotFoundError);
  });
});
