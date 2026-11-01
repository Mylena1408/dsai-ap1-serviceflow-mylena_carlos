import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthenticationError } from "@/server/errors";
import {
  createDomainCategory,
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

import { addComment } from "@/modules/comments";
import { runOutbox } from "@/modules/events";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  notificationConsumer,
  openNotification,
  purgeReadNotifications,
} from "@/modules/notifications";
import { assumeRequest, cancelRequest, createRequest, transferRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-10-31-eventos-outbox-jobs, section 8 (SF-063).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor | null) {
  session.getCurrentUser.mockResolvedValue(actor && { ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Cadeira solta" }, prisma);
  return { service, rita, ana, bia, request };
}

const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const notificationsOf = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" } });

describe("in-app notifications (SF-063)", () => {
  it("notifies the right people and never the author (CA-EVT-06)", async () => {
    const { rita, ana, bia, request } = await scenario();

    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await addComment({ requestId: request.id, body: "Pode descrever melhor?" }, prisma);
    await transferRequest({ requestId: request.id, assigneeId: bia.id }, prisma);
    actAs(bia);
    await addComment({ requestId: request.id, body: "Nota da equipe", isInternal: false }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    actAs(rita);
    await addComment({ requestId: request.id, body: "Claro, é o encosto." }, prisma);
    actAs(ana);
    await addComment({ requestId: request.id, body: "Lembrar do almoxarifado", isInternal: true }, prisma);
    await process();

    expect((await notificationsOf(rita.id)).map(({ type }) => type)).toEqual([
      "comment.public",
      "comment.public",
      "status.IN_PROGRESS",
    ]);
    expect((await notificationsOf(bia.id)).map(({ type }) => type)).toEqual([
      "assignment.received",
      "comment.public",
      "comment.internal",
    ]);
    await expect(notificationsOf(ana.id)).resolves.toEqual([]);
    expect(JSON.stringify(await prisma.requestNotification.findMany())).not.toContain("almoxarifado");
  });

  it("does not duplicate notifications when an event is processed again (CA-EVT-03)", async () => {
    const { ana, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Resposta" }, prisma);
    await process();
    await prisma.outboxEvent.updateMany({ data: { processedAt: null, availableAt: new Date(0) } });

    await process();

    await expect(prisma.requestNotification.count()).resolves.toBe(1);
  });

  it("skips inactive recipients and requests without an effective assignee (E4)", async () => {
    const { rita, ana, request } = await scenario();
    actAs(rita);
    await addComment({ requestId: request.id, body: "Alguém pode ver?" }, prisma);
    await cancelRequest({ requestId: request.id }, prisma);
    actAs(ana);
    await process();
    await expect(prisma.requestNotification.count()).resolves.toBe(0);

    const second = await scenario();
    actAs(second.ana);
    await addComment({ requestId: second.request.id, body: "Resposta" }, prisma);
    await prisma.user.update({ where: { id: second.rita.id }, data: { isActive: false } });
    await process();
    await expect(prisma.requestNotification.count()).resolves.toBe(0);
  });

  it("shows each user only their own notifications and marks them as read (CA-EVT-07)", async () => {
    const { rita, ana, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Primeira" }, prisma);
    await addComment({ requestId: request.id, body: "Segunda" }, prisma);
    await process();

    actAs(ana);
    await expect(countUnreadNotifications(prisma)).resolves.toBe(0);
    await expect(listNotifications(prisma)).resolves.toEqual([]);
    const [first] = await notificationsOf(rita.id);
    await expect(openNotification(first.id, prisma)).resolves.toBeNull();

    actAs(rita);
    await expect(countUnreadNotifications(prisma)).resolves.toBe(2);
    const listed = await listNotifications(prisma);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toMatchObject({ requestId: request.id, readAt: null, serviceName: expect.any(String) });
    await expect(openNotification(first.id, prisma)).resolves.toBe(request.id);
    await expect(countUnreadNotifications(prisma)).resolves.toBe(1);
    await markAllNotificationsRead(prisma);
    await expect(countUnreadNotifications(prisma)).resolves.toBe(0);

    actAs(null);
    await expect(listNotifications(prisma)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("purges only notifications read before the cutoff", async () => {
    const { rita, ana, request } = await scenario();
    actAs(ana);
    await addComment({ requestId: request.id, body: "Uma" }, prisma);
    await addComment({ requestId: request.id, body: "Outra" }, prisma);
    await process();
    const [old] = await notificationsOf(rita.id);
    await prisma.requestNotification.update({
      where: { id: old.id },
      data: { readAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });

    await expect(purgeReadNotifications(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), prisma)).resolves.toBe(1);
    await expect(prisma.requestNotification.count()).resolves.toBe(1);
  });
});
