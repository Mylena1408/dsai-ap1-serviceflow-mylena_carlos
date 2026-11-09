import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { NotFoundError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { addComment, countUnseenMentions, listMyMentions, openMention } from "@/modules/comments";
import { createRequest } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1 (SF-231; CA-MEN-04; correction of 13.10).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

describe("\"Minhas menções\" (13.4 item 1)", () => {
  it("lists the person's mentions on requests of the sector, newest first, and opening marks one seen", async () => {
    const ti = await createDomainSector();
    const rh = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: ti.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
    const bia = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
    const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
    actAs(rita);
    const first = await createRequest({ serviceId: service.id, description: "Primeira", fieldValues: {} }, prisma);
    const second = await createRequest({ serviceId: service.id, description: "Segunda", fieldValues: {} }, prisma);

    actAs(ana);
    const older = await addComment({ requestId: first.id, body: "Bia, veja.", isInternal: true, mentionIds: [bia.id] }, prisma);
    const newer = await addComment({ requestId: second.id, body: "Bia, e esta?", isInternal: true, mentionIds: [bia.id] }, prisma);

    actAs(bia);
    expect((await listMyMentions()).map(({ commentId, authorName, seenAt }) => [commentId, authorName, seenAt])).toEqual([
      [newer.id, ana.name, null],
      [older.id, ana.name, null],
    ]);
    expect(await countUnseenMentions()).toBe(2);

    await expect(openMention(older.id)).resolves.toBe(first.id);
    expect(await countUnseenMentions()).toBe(1);
    const seenAt = (await listMyMentions()).find(({ commentId }) => commentId === older.id)?.seenAt;
    expect(seenAt).toBeInstanceOf(Date);
    // Opening again keeps the first time.
    await openMention(older.id);
    expect((await listMyMentions()).find(({ commentId }) => commentId === older.id)?.seenAt).toEqual(seenAt);

    // Someone else's mention, or a mention on a request moved to another sector, is not reachable.
    actAs(ana);
    await expect(openMention(newer.id)).rejects.toBeInstanceOf(NotFoundError);
    await prisma.request.update({ where: { id: second.id }, data: { sectorId: rh.id } });
    actAs(bia);
    expect((await listMyMentions()).map(({ commentId }) => commentId)).toEqual([older.id]);
    await expect(openMention(newer.id)).rejects.toBeInstanceOf(NotFoundError);

    // Nobody else has mentions.
    for (const actor of [gabi, rita]) {
      actAs(actor);
      expect(await listMyMentions()).toEqual([]);
      expect(await countUnseenMentions()).toBe(0);
    }
  });
});
