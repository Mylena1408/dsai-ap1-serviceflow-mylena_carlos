import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { generateApiToken } from "@/modules/api-tokens";
import { runOutbox } from "@/modules/events";
import { getRequest, OPENAPI_DOCUMENT, postPauseSla, postResumeSla } from "@/modules/public-api";
import { encryptWebhookSecret, generateWebhookSecret, webhookConsumer } from "@/modules/webhooks";

// SPEC 2026-11-03-pausa-sla-calendario, 5.8 (SF-131; CA-PSL-06, 08 and 09).

type Handler = (request: Request, context: { params: Promise<{ requestId: string }> }) => Promise<Response>;

async function tokenFor(user: User, scope: "READ" | "WRITE" = "WRITE"): Promise<string> {
  const token = generateApiToken();
  const now = new Date();
  await prisma.apiToken.create({
    data: { userId: user.id, name: `token ${scope}`, scope, tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  });
  return token.value;
}

async function call(handler: Handler, requestId: string, token: string, body?: unknown, method = "POST") {
  const response = await handler(
    new Request(`https://serviceflow.test/api/v1/requests/${requestId}/x`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ requestId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function scenario() {
  const sector = await createDomainSector();
  const other = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: other.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id, status: "IN_PROGRESS" });
  const dueAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await prisma.request.update({ where: { id: request.id }, data: { assigneeId: ana.id, slaHoursSnapshot: 10, dueAt } });
  return { sector, other, rita, ana, bia, caio, request, dueAt };
}

describe("pausing and resuming the SLA through the API (SF-131; CA-PSL-09)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies the rules of the screen and shows situation, pause and history", async () => {
    const { rita, ana, bia, caio, request, dueAt } = await scenario();
    const [anaToken, anaRead, biaToken, caioToken, ritaToken] = [
      await tokenFor(ana),
      await tokenFor(ana, "READ"),
      await tokenFor(bia),
      await tokenFor(caio),
      await tokenFor(rita),
    ];
    const reason = { reason: "Qual é o patrimônio?" };

    expect(await call(postPauseSla, request.id, anaRead, reason)).toMatchObject({ status: 403, body: { error: { code: "insufficient_scope" } } });
    expect(await call(postPauseSla, request.id, anaToken, {})).toMatchObject({ status: 400 });
    expect(await call(postPauseSla, request.id, anaToken, { reason: "   " })).toMatchObject({ status: 400 });
    expect(await call(postPauseSla, request.id, anaToken, { ...reason, extra: 1 })).toMatchObject({ status: 400 });
    expect(await call(postPauseSla, request.id, biaToken, reason)).toMatchObject({ status: 409 });
    expect(await call(postPauseSla, request.id, caioToken, reason)).toMatchObject({ status: 404 });
    expect(await call(postPauseSla, request.id, ritaToken, reason)).toMatchObject({ status: 404 });
    expect(await call(postResumeSla, request.id, anaToken, {})).toMatchObject({ status: 409 });

    const paused = await call(postPauseSla, request.id, anaToken, reason);
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ slaSituation: "paused", slaBusinessHours: false, dueAt: dueAt.toISOString() });
    expect(paused.body.slaPausedAt).toEqual(expect.any(String));
    expect(paused.body.history.pauses).toEqual([
      {
        reason: "Qual é o patrimônio?",
        pausedBy: { id: ana.id, name: ana.name },
        pausedAt: paused.body.slaPausedAt,
        resumedAt: null,
        resumedBy: null,
        resumeCause: null,
      },
    ]);
    expect(await call(postPauseSla, request.id, anaToken, reason)).toMatchObject({ status: 409 });

    // The requester reads the pause and the reason in the detail.
    const own = await call(getRequest, request.id, ritaToken, undefined, "GET");
    expect(own.body).toMatchObject({ slaSituation: "paused", history: { pauses: [{ reason: "Qual é o patrimônio?" }] } });

    const resumed = await call(postResumeSla, request.id, anaToken, {});
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ slaSituation: "on_time", slaPausedAt: null });
    expect(resumed.body.history.pauses[0]).toMatchObject({ resumedBy: { id: ana.id }, resumeCause: "MANUAL" });
    expect(new Date(resumed.body.dueAt).getTime()).toBeGreaterThanOrEqual(dueAt.getTime());
  });

  it("describes the two routes and the new values in the OpenAPI", () => {
    const paths = OPENAPI_DOCUMENT.paths as Record<string, { post?: { requestBody?: unknown } }>;
    expect(paths["/api/v1/requests/{requestId}/pause-sla"]?.post?.requestBody).toBeDefined();
    expect(paths["/api/v1/requests/{requestId}/resume-sla"]?.post).toBeDefined();
    expect(JSON.stringify(OPENAPI_DOCUMENT)).toContain('"paused"');
  });
});

describe("pause and resume reach webhooks (SF-131; CA-PSL-08)", () => {
  afterAll(() => {
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
  });

  it("registers deliveries with identifiers only, filtered by the request's sector", async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const { sector, other, ana, request } = await scenario();
    const key = Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY, "base64");
    const webhook = (name: string, sectorIds: string[]) =>
      prisma.webhookEndpoint.create({
        data: {
          name,
          url: `https://hooks.exemplo.com/${name}`,
          eventTypes: ["request.sla_paused", "request.sla_resumed"],
          sectorIds,
          encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), key),
        },
      });
    const mine = await webhook("setor", [sector.id]);
    const elsewhere = await webhook("outro", [other.id]);

    const token = await tokenFor(ana);
    await call(postPauseSla, request.id, token, { reason: "Texto que não vai para o webhook" });
    await call(postResumeSla, request.id, token, {});
    await runOutbox([webhookConsumer(prisma)], { maxBatches: 5 }, prisma);

    const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: { in: [mine.id, elsewhere.id] } }, orderBy: { createdAt: "asc" } });
    expect(deliveries.map(({ endpointId, eventType }) => [endpointId, eventType])).toEqual([
      [mine.id, "request.sla_paused"],
      [mine.id, "request.sla_resumed"],
    ]);
    const bodies = deliveries.map(({ body }) => (typeof body === "string" ? JSON.parse(body) : body));
    expect(bodies[0].data).toEqual({ pauseId: expect.any(String), actorId: ana.id });
    expect(bodies[1].data).toEqual({ pauseId: bodies[0].data.pauseId, actorId: ana.id, cause: "manual" });
    expect(JSON.stringify(bodies)).not.toContain("Texto que não vai");
  });
});
