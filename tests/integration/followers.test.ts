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

import { addFollower, getFollowerReading, getRequestFollowers, removeFollower } from "@/modules/followers";
import { getFollowedRequest, getRequesterRequest, listFollowedRequests } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 items 1, 2 and 4 (SF-212; CA-SEG-02 and CA-SEG-03).

type Actor = { id: string; name: string; email?: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: actor.email ?? `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const lia = await createDomainUser({ role: "REQUESTER" });
  const rui = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  const emailOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } })).email;
  return { rita, lia, rui, ana, caio, gabi, request, emailOf };
}

describe("adding and removing followers (6.3 items 1 and 4)", () => {
  it("the requester adds a colleague by e-mail; the attendant follows themselves; both in the history", async () => {
    const { rita, lia, ana, request, emailOf } = await scenario();
    actAs(rita);
    await expect(addFollower({ requestId: request.id, email: (await emailOf(lia.id)).toUpperCase() })).resolves.toEqual({ added: "colleague" });
    actAs(ana);
    await expect(addFollower({ requestId: request.id })).resolves.toEqual({ added: "attendant" });

    actAs(rita);
    const view = await getRequestFollowers(request.id);
    expect(view.followers.map(({ userId, kind }) => [userId, kind])).toEqual([
      [lia.id, "colleague"],
      [ana.id, "attendant"],
    ]);
    expect(view.removableIds).toEqual([lia.id]);
    expect(view.events.map(({ action, userName }) => [action, userName])).toEqual([
      ["ADDED", lia.name],
      ["ADDED", ana.name],
    ]);
  });

  it("refuses an unknown e-mail without saying so, a non-requester, following twice, and anyone else adding", async () => {
    const { rita, lia, rui, ana, caio, request, emailOf } = await scenario();
    actAs(rita);
    await expect(addFollower({ requestId: request.id, email: "ninguem@example.test" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addFollower({ requestId: request.id, email: await emailOf(ana.id) })).rejects.toBeInstanceOf(ValidationError);
    await addFollower({ requestId: request.id, email: await emailOf(lia.id) });
    await expect(addFollower({ requestId: request.id, email: await emailOf(lia.id) })).rejects.toBeInstanceOf(ConflictError);

    for (const actor of [lia, rui, caio]) {
      actAs(actor);
      await expect(addFollower({ requestId: request.id, email: await emailOf(rui.id) })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("the requester removes a colleague; a follower stops following; the requester never removes an attendant", async () => {
    const { rita, lia, rui, ana, request, emailOf } = await scenario();
    actAs(rita);
    await addFollower({ requestId: request.id, email: await emailOf(lia.id) });
    await addFollower({ requestId: request.id, email: await emailOf(rui.id) });
    actAs(ana);
    await addFollower({ requestId: request.id });

    actAs(rita);
    await removeFollower({ requestId: request.id, userId: lia.id });
    await expect(removeFollower({ requestId: request.id, userId: ana.id })).rejects.toBeInstanceOf(NotFoundError);
    actAs(rui);
    await removeFollower({ requestId: request.id, userId: rui.id });
    actAs(ana);
    await removeFollower({ requestId: request.id, userId: ana.id });
    await expect(removeFollower({ requestId: request.id, userId: ana.id })).rejects.toBeInstanceOf(ConflictError);

    expect(await prisma.requestFollower.count({ where: { requestId: request.id } })).toBe(0);
    expect(await prisma.requestFollowerEvent.count({ where: { requestId: request.id, action: "REMOVED" } })).toBe(3);
  });
});

describe("the colleague's reading (6.3 item 2; decision I13)", () => {
  it("reads the request, the public comments, the requester's answers and the documents' names; never internal notes", async () => {
    const { rita, lia, ana, request, emailOf } = await scenario();
    await prisma.requestComment.createMany({
      data: [
        { requestId: request.id, authorId: rita.id, body: "Pergunta pública" },
        { requestId: request.id, authorId: ana.id, body: "Nota só da equipe", isInternal: true },
      ],
    });
    actAs(lia);
    await expect(getFollowedRequest(request.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getFollowerReading(request.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listFollowedRequests()).toEqual([]);

    actAs(rita);
    await addFollower({ requestId: request.id, email: await emailOf(lia.id) });
    actAs(lia);
    await expect(getFollowedRequest(request.id)).resolves.toMatchObject({ id: request.id });
    expect((await listFollowedRequests()).map(({ id }) => id)).toEqual([request.id]);
    const reading = await getFollowerReading(request.id);
    expect(reading.comments.map(({ body }) => body)).toEqual(["Pergunta pública"]);
    // The colleague does not use the requester's own path.
    await expect(getRequesterRequest(request.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an attendant who follows does not read through the colleague's path; a stopped colleague no longer reads", async () => {
    const { rita, lia, ana, request, emailOf } = await scenario();
    actAs(ana);
    await addFollower({ requestId: request.id });
    await expect(getFollowerReading(request.id)).rejects.toBeInstanceOf(NotFoundError);

    actAs(rita);
    await addFollower({ requestId: request.id, email: await emailOf(lia.id) });
    await removeFollower({ requestId: request.id, userId: lia.id });
    actAs(lia);
    await expect(getFollowedRequest(request.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("who follows is read by the requester, a colleague and the sector's team; not by others", async () => {
    const { rita, lia, rui, ana, caio, gabi, request, emailOf } = await scenario();
    actAs(rita);
    await addFollower({ requestId: request.id, email: await emailOf(lia.id) });
    for (const actor of [rita, lia, ana, gabi]) {
      actAs(actor);
      await expect(getRequestFollowers(request.id)).resolves.toMatchObject({ followers: [{ userId: lia.id }] });
    }
    for (const actor of [rui, caio]) {
      actAs(actor);
      await expect(getRequestFollowers(request.id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
