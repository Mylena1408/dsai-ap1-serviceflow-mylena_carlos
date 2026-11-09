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

import { addComment } from "@/modules/comments";
import { getFollowPreference, setFollowPreference } from "@/modules/followers";
import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { assumeRequest, transferRequest } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2 (SF-230; part of CA-SEG-06; decision J7).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  return { rita, ana, bia, request };
}

const followersOf = async (requestId: string) =>
  (await prisma.requestFollower.findMany({ where: { requestId }, select: { userId: true } })).map(({ userId }) => userId);

describe("following on comment (13.3 item 2; decision J7)", () => {
  it("an attendant who comments follows, once, with the history; the requester does not", async () => {
    const { rita, ana, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Vou verificar." }, prisma);
    await addComment({ requestId: request.id, body: "Nota da equipe.", isInternal: true }, prisma);
    expect(await followersOf(request.id)).toEqual([ana.id]);
    expect(await prisma.requestFollowerEvent.count({ where: { requestId: request.id, userId: ana.id, action: "ADDED" } })).toBe(1);

    actAs(rita);
    await addComment({ requestId: request.id, body: "Obrigada." }, prisma);
    expect(await followersOf(request.id)).toEqual([ana.id]);
  });

  it("is on by default and turned off by the preference, per person", async () => {
    const { ana, bia, request } = await scenario();
    actAs(bia);
    await expect(getFollowPreference()).resolves.toEqual({ autoFollowOnComment: true });
    await setFollowPreference({ autoFollowOnComment: false });
    await expect(getFollowPreference()).resolves.toEqual({ autoFollowOnComment: false });
    await addComment({ requestId: request.id, body: "Comentário sem seguir." }, prisma);
    expect(await followersOf(request.id)).toEqual([]);

    actAs(ana);
    await addComment({ requestId: request.id, body: "Comentário seguindo." }, prisma);
    expect(await followersOf(request.id)).toEqual([ana.id]);
  });

  it("only attendants have the preference", async () => {
    const { rita } = await scenario();
    actAs(rita);
    await expect(getFollowPreference()).rejects.toBeInstanceOf(NotFoundError);
    await expect(setFollowPreference({ autoFollowOnComment: false })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the attendant who followed by commenting hears of the requester's reply after a transfer", async () => {
    const { rita, ana, bia, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await addComment({ requestId: request.id, body: "Pode descrever melhor?" }, prisma);
    await transferRequest({ requestId: request.id, assigneeId: bia.id }, prisma);
    actAs(rita);
    await addComment({ requestId: request.id, body: "Claro, é o encosto." }, prisma);
    await runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);

    const received = await prisma.requestNotification.findMany({ where: { recipientId: { in: [ana.id, bia.id] }, type: "comment.public" }, select: { recipientId: true } });
    expect(received.map(({ recipientId }) => recipientId).sort()).toEqual([ana.id, bia.id].sort());
  });
});
