import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { addComment } from "@/modules/comments";
import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { createRequest } from "@/modules/requests";
import { setFollowPreference } from "@/modules/followers";

// SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 and 7.4 (SF-215; CA-MEN-01 to 03).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const processEvents = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const off = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id, isActive: false });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Teclado", fieldValues: {} }, prisma);
  return { rita, ana, bia, caio, gabi, off, request };
}

describe("mentions in internal notes (7.3; CA-MEN-02)", () => {
  it("keeps the chosen colleagues and notifies each once, never the author", async () => {
    const { ana, bia, request } = await scenario();
    actAs(ana);
    // Ana does not start following, so only the mention reaches anyone here.
    await setFollowPreference({ autoFollowOnComment: false }, prisma);
    const comment = await addComment({ requestId: request.id, body: "Bia, pode ver o teclado?", isInternal: true, mentionIds: [bia.id, ana.id] }, prisma);
    expect((await prisma.commentMention.findMany({ where: { commentId: comment.id }, select: { userId: true } })).map(({ userId }) => userId)).toEqual([bia.id]);
    await processEvents();
    const notices = await prisma.requestNotification.findMany({ where: { requestId: request.id }, select: { recipientId: true, type: true } });
    expect(notices).toEqual([{ recipientId: bia.id, type: "comment.mention" }]);
  });

  it("refuses public comments, managers, other sectors, inactive people and more than 5; nothing is written", async () => {
    const { ana, bia, caio, gabi, off, request } = await scenario();
    actAs(ana);
    for (const input of [
      { body: "Público", isInternal: false, mentionIds: [bia.id] },
      { body: "Gestor", isInternal: true, mentionIds: [gabi.id] },
      { body: "Outro setor", isInternal: true, mentionIds: [caio.id] },
      { body: "Inativo", isInternal: true, mentionIds: [off.id] },
    ]) {
      await expect(addComment({ requestId: request.id, ...input }, prisma)).rejects.toBeInstanceOf(ValidationError);
    }
    const many = await Promise.all(Array.from({ length: 6 }, () => createDomainUser({ role: "ATTENDANT", sectorId: (bia as Actor).sectorId })));
    await expect(addComment({ requestId: request.id, body: "Muitos", isInternal: true, mentionIds: many.map(({ id }) => id) }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await prisma.requestComment.count({ where: { requestId: request.id } })).toBe(0);
    expect(await prisma.commentMention.count()).toBe(0);
  });

  it("a note without mentions notifies as before (CA-MEN-01)", async () => {
    const { ana, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Só uma nota.", isInternal: true }, prisma);
    expect(await prisma.commentMention.count()).toBe(0);
  });
});
