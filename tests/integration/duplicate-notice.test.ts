import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { cancelRequest, closeAsDuplicate, createRequest, getFollowedDuplicateOriginal, linkRequests } from "@/modules/requests";
import { removeFollower } from "@/modules/followers";

// SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 2 and 8.4 (SF-218; CA-DUP-03).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const processEvents = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const code = (id: string) => id.slice(0, 8).toUpperCase();

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const lia = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(rita);
  const original = await createRequest({ serviceId: service.id, description: "Cadeira quebrada", fieldValues: {} }, prisma);
  actAs(lia);
  const duplicate = await createRequest({ serviceId: service.id, description: "Cadeira da sala 2", fieldValues: {} }, prisma);
  await processEvents();
  return { rita, lia, ana, original, duplicate };
}

const noticesOf = (requestId: string) =>
  prisma.requestNotification.findMany({ where: { requestId }, select: { recipientId: true, type: true } });

describe("the duplicate's closing, to its requester", () => {
  it("sends the duplicate's notice instead of the cancellation's, and shows the original while they follow it", async () => {
    const { lia, ana, original, duplicate } = await scenario();
    actAs(ana);
    await linkRequests({ requestId: duplicate.id, code: code(original.id), kind: "DUPLICATE_OF" }, prisma);
    await closeAsDuplicate({ requestId: duplicate.id, note: "Mesmo pedido." }, prisma);
    await processEvents();

    expect(await noticesOf(duplicate.id)).toEqual([{ recipientId: lia.id, type: "status.DUPLICATE" }]);

    actAs(lia);
    await expect(getFollowedDuplicateOriginal(duplicate.id, prisma)).resolves.toEqual({
      id: original.id,
      serviceName: original.serviceNameSnapshot,
    });

    // Once they stop following, the shortcut goes away.
    await removeFollower({ requestId: original.id, userId: lia.id }, prisma);
    await expect(getFollowedDuplicateOriginal(duplicate.id, prisma)).resolves.toBeNull();
  });

  it("a plain cancellation keeps its notice and shows no original", async () => {
    const { lia, ana, duplicate } = await scenario();
    actAs(ana);
    await cancelRequest({ requestId: duplicate.id, note: "Fora do escopo." }, prisma);
    await processEvents();
    expect(await noticesOf(duplicate.id)).toEqual([{ recipientId: lia.id, type: "status.CANCELLED" }]);
    actAs(lia);
    await expect(getFollowedDuplicateOriginal(duplicate.id, prisma)).resolves.toBeNull();
  });

  it("nobody else reads it through this path", async () => {
    const { rita, ana, original, duplicate } = await scenario();
    actAs(ana);
    await linkRequests({ requestId: duplicate.id, code: code(original.id), kind: "DUPLICATE_OF" }, prisma);
    await closeAsDuplicate({ requestId: duplicate.id, note: "Mesmo pedido." }, prisma);
    // The original's requester does not own the duplicate.
    actAs(rita);
    await expect(getFollowedDuplicateOriginal(duplicate.id, prisma)).resolves.toBeNull();
    // Only requesters ask.
    actAs(ana);
    await expect(getFollowedDuplicateOriginal(duplicate.id, prisma)).rejects.toThrow();
  });
});
