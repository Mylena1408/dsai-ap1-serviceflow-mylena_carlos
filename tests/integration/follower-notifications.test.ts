import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createMemoryDocumentStorage } from "@/server/storage";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { addComment } from "@/modules/comments";
import { runOutbox } from "@/modules/events";
import { notificationConsumer, updateEmailPreferences } from "@/modules/notifications";
import { createRequest } from "@/modules/requests";
import { addFollower } from "@/modules/followers";
import { anonymizeUser, setUserActive } from "@/modules/users";

// SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 items 3 and 5 (SF-213; CA-SEG-04).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const processEvents = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const lia = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Cadeira quebrada", fieldValues: {} }, prisma);
  const liaEmail = (await prisma.user.findUniqueOrThrow({ where: { id: lia.id }, select: { email: true } })).email;
  await addFollower({ requestId: request.id, email: liaEmail }, prisma);
  actAs(bia);
  await addFollower({ requestId: request.id }, prisma);
  await processEvents();
  return { sector, other, admin, rita, lia, ana, bia, request };
}

const noticesOf = (requestId: string) =>
  prisma.requestNotification.findMany({ where: { requestId }, select: { recipientId: true, type: true, email: { select: { id: true } } } });

describe("notices to followers (6.3 item 3; decision I12)", () => {
  it("an attendant's public comment reaches the requester and the colleague; the requester's reaches the following attendant", async () => {
    const { rita, lia, ana, bia, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Vamos trocar o encosto." }, prisma);
    await processEvents();
    expect((await noticesOf(request.id)).map(({ recipientId, type }) => `${recipientId}:${type}`).sort()).toEqual(
      [`${lia.id}:comment.public`, `${rita.id}:comment.public`].sort(),
    );

    actAs(rita);
    await addComment({ requestId: request.id, body: "Obrigada!" }, prisma);
    await processEvents();
    const types = (await noticesOf(request.id)).map(({ recipientId, type }) => `${recipientId}:${type}`);
    // Nobody holds it: the team's notice of a public comment goes to the assignee, so nobody else; the colleague never
    // hears of the requester's own comment.
    expect(types.filter((item) => item.startsWith(bia.id))).toEqual([]);
    expect(types.filter((item) => item === `${lia.id}:comment.public`)).toHaveLength(1);
  });

  it("each person's e-mail choice still decides the e-mail", async () => {
    const { lia, ana, request } = await scenario();
    actAs(lia);
    await updateEmailPreferences({ categories: ["COMMENTS"] }, prisma);
    actAs(ana);
    await addComment({ requestId: request.id, body: "Encosto trocado." }, prisma);
    await processEvents();
    const notices = await noticesOf(request.id);
    expect(notices.find(({ recipientId }) => recipientId === lia.id)?.email).not.toBeNull();
  });

  it("an inactive or anonymized follower receives nothing and stops following (6.3 item 5)", async () => {
    const { admin, lia, ana, request } = await scenario();
    actAs(admin);
    await setUserActive(lia.id, false, prisma);
    actAs(ana);
    await addComment({ requestId: request.id, body: "Aviso para todos." }, prisma);
    await processEvents();
    expect((await noticesOf(request.id)).some(({ recipientId }) => recipientId === lia.id)).toBe(false);

    actAs(admin);
    await anonymizeUser({ userId: lia.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    expect(await prisma.requestFollower.count({ where: { userId: lia.id } })).toBe(0);
  });
});
