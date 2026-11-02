import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.2 and 5.3 (SF-094; CA-MAIL-01, 04 to 07).
// The provider is never called: fetch is replaced in every send.

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { addComment } from "@/modules/comments";
import { runOutbox, type ClaimedEvent } from "@/modules/events";
import { notificationConsumer, runEmailDeliveries, updateEmailPreferences } from "@/modules/notifications";
import { assumeRequest, createRequest, transitionRequestStatus } from "@/modules/requests";
import { runDailyJob } from "@/server/jobs";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

const configured = { EMAIL_API_KEY: "test-key-not-real", EMAIL_FROM: "ServiceFlow <avisos@exemplo.test>", APP_BASE_URL: "https://sf.example" };

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Cadeira solta" }, prisma);
  return { service, rita, ana, request };
}

const processEvents = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const deliveriesOf = (recipientId: string) =>
  prisma.emailDelivery.findMany({
    where: { recipientId },
    orderBy: { createdAt: "asc" },
    include: { notification: { select: { type: true } } },
  });

/** Ana assumes and starts the request, and comments on it: notifications for Rita. */
async function attendRequest(ana: Actor, requestId: string) {
  actAs(ana);
  await assumeRequest({ requestId }, prisma);
  await transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, prisma);
  await addComment({ requestId, body: "Vou trocar o encosto." }, prisma);
  await processEvents();
}

describe("recording email deliveries (SF-094)", () => {
  it("records nothing while nobody turned email on (CA-MAIL-01)", async () => {
    const { rita, ana, request } = await scenario();
    await attendRequest(ana, request.id);

    await expect(prisma.requestNotification.count({ where: { recipientId: rita.id } })).resolves.toBe(2);
    await expect(prisma.emailDelivery.count()).resolves.toBe(0);
  });

  it("records one delivery per notification of a category turned on, in the same operation (CA-MAIL-04)", async () => {
    const { rita, ana, request } = await scenario();
    actAs(rita);
    await updateEmailPreferences({ categories: ["STATUS"] }, prisma);
    await attendRequest(ana, request.id);

    const deliveries = await deliveriesOf(rita.id);
    expect(deliveries.map(({ notification, status }) => [notification.type, status])).toEqual([["status.IN_PROGRESS", "PENDING"]]);

    // Processing the same event again inserts no notification and no delivery.
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id, type: "request.status_changed" } });
    await notificationConsumer(prisma).handle(event as unknown as ClaimedEvent);
    await expect(prisma.emailDelivery.count({ where: { recipientId: rita.id } })).resolves.toBe(1);
  });

  it("keeps recorded deliveries when the preference changes (CA-MAIL-05)", async () => {
    const { rita, ana, request } = await scenario();
    actAs(rita);
    await updateEmailPreferences({ categories: ["STATUS", "COMMENTS"] }, prisma);
    await attendRequest(ana, request.id);
    actAs(rita);
    await updateEmailPreferences({ categories: [] }, prisma);

    // Even reprocessing an event after the change adds nothing: the choice of that moment counted.
    const comment = await prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id, type: "request.comment_added" } });
    await notificationConsumer(prisma).handle(comment as unknown as ClaimedEvent);

    expect((await deliveriesOf(rita.id)).map(({ notification }) => notification.type)).toEqual([
      "status.IN_PROGRESS",
      "comment.public",
    ]);
  });
});

describe("sending email deliveries (SF-094)", () => {
  async function pendingFor() {
    const { rita, ana, request } = await scenario();
    actAs(rita);
    await updateEmailPreferences({ categories: ["STATUS"] }, prisma);
    await attendRequest(ana, request.id);
    return { rita, request };
  }

  it("sends to the current address and marks it sent (CA-MAIL-06, 08)", async () => {
    const { rita, request } = await pendingFor();
    await prisma.user.update({ where: { id: rita.id }, data: { email: `novo-${rita.id}@example.test` } });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(runEmailDeliveries({}, prisma, configured, fetchImpl as typeof fetch)).resolves.toEqual({
      sent: 1,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.to).toEqual([`novo-${rita.id}@example.test`]);
    expect(body.subject).toMatch(/^\[ServiceFlow\] Atendimento iniciado: /);
    expect(body.text).toContain(`https://sf.example/requests/${request.id}`);
    expect(body.text).not.toContain("Cadeira solta");
    expect(await deliveriesOf(rita.id)).toEqual([expect.objectContaining({ status: "SENT", attempts: 1, lastErrorCode: null })]);

    // Nothing is sent twice.
    await runEmailDeliveries({}, prisma, configured, fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("schedules a retry after a provider failure, keeping only the code (CA-MAIL-06)", async () => {
    const { rita } = await pendingFor();
    const before = new Date();
    const failing = (async () => new Response('{"message":"invalid"}', { status: 500 })) as typeof fetch;

    await expect(runEmailDeliveries({}, prisma, configured, failing)).resolves.toMatchObject({ retried: 1 });
    const [delivery] = await deliveriesOf(rita.id);
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, lastErrorCode: "HTTP_500", sentAt: null });
    expect(delivery.availableAt.getTime()).toBeGreaterThan(before.getTime());

    // Not due yet: a new run leaves it alone.
    await expect(runEmailDeliveries({}, prisma, configured, failing)).resolves.toEqual({ sent: 0, retried: 0, failed: 0, skipped: 0 });
  });

  it("records not sent without configuration or for an inactive person, never retried (CA-MAIL-07)", async () => {
    const first = await pendingFor();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(runEmailDeliveries({}, prisma, {}, fetchImpl as typeof fetch)).resolves.toMatchObject({ skipped: 1 });
    expect(await deliveriesOf(first.rita.id)).toEqual([expect.objectContaining({ status: "SKIPPED", lastErrorCode: "not_configured", attempts: 0 })]);

    const second = await pendingFor();
    await prisma.user.update({ where: { id: second.rita.id }, data: { isActive: false } });
    await runEmailDeliveries({}, prisma, configured, fetchImpl as typeof fetch);
    expect(await deliveriesOf(second.rita.id)).toEqual([expect.objectContaining({ status: "SKIPPED", lastErrorCode: "recipient_inactive" })]);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runs in the daily job, after the events (unconfigured in tests: recorded as not sent)", async () => {
    const { rita, ana, request } = await scenario();
    actAs(rita);
    await updateEmailPreferences({ categories: ["STATUS"] }, prisma);
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);

    const summary = await runDailyJob();
    expect(summary.emails).toEqual({ status: "ok", result: { sent: 0, retried: 0, failed: 0, skipped: 1 } });
    expect(await deliveriesOf(rita.id)).toEqual([expect.objectContaining({ status: "SKIPPED", lastErrorCode: "not_configured" })]);
  });
});
