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
import { getRequest, getSectorCandidates, postAssume, postTransferSector } from "@/modules/public-api";
import { encryptWebhookSecret, generateWebhookSecret, webhookConsumer } from "@/modules/webhooks";
import type { ClaimedEvent } from "@/modules/events";

// SPEC 2026-11-03-transferencia-entre-setores, 5.7 and 5.8 (SF-122; CA-SET-06 and 07).

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
  const reception = await createDomainSector();
  const maintenance = await createDomainSector();
  const people = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: reception.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: reception.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: reception.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: maintenance.id });
  await createDomainUser({ role: "ATTENDANT", sectorId: people.id });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: reception.id });
  return { reception, maintenance, people, rita, ana, bia, caio, request };
}

describe("moving a request through the API (SF-122; CA-SET-07)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the destinations and moves the request with the rules of the screen", async () => {
    const { reception, maintenance, people, rita, ana, bia, caio, request } = await scenario();
    const [anaToken, biaToken, caioToken, ritaToken, anaRead] = [
      await tokenFor(ana),
      await tokenFor(bia),
      await tokenFor(caio),
      await tokenFor(rita),
      await tokenFor(ana, "READ"),
    ];

    const candidates = await call(getSectorCandidates, request.id, anaRead, undefined, "GET");
    expect(candidates.status).toBe(200);
    expect(candidates.body.items.map(({ id }: { id: string }) => id).sort()).toEqual([maintenance.id, people.id].sort());
    expect(await call(getSectorCandidates, request.id, ritaToken, undefined, "GET")).toMatchObject({ status: 403 });
    expect(await call(getSectorCandidates, request.id, caioToken, undefined, "GET")).toMatchObject({ status: 404 });

    const move = { sectorId: maintenance.id, note: "Pedido é da manutenção" };
    expect(await call(postTransferSector, request.id, anaRead, move)).toMatchObject({ status: 403, body: { error: { code: "insufficient_scope" } } });
    expect(await call(postTransferSector, request.id, anaToken, { sectorId: maintenance.id })).toMatchObject({ status: 400 });
    expect(await call(postTransferSector, request.id, anaToken, { ...move, sectorId: reception.id })).toMatchObject({ status: 400 });
    expect(await call(postTransferSector, request.id, anaToken, { ...move, extra: true })).toMatchObject({ status: 400 });
    expect(await call(postTransferSector, request.id, ritaToken, move)).toMatchObject({ status: 404 });

    expect(await call(postAssume, request.id, anaToken)).toMatchObject({ status: 200 });
    expect(await call(postTransferSector, request.id, biaToken, move)).toMatchObject({ status: 409, body: { error: { code: "conflict" } } });

    expect(await call(postTransferSector, request.id, anaToken, move)).toEqual({ status: 200, body: { id: request.id, sectorId: maintenance.id } });
    expect(schedule.scheduleEventProcessing).toHaveBeenCalled();

    // The previous sector no longer reads it; the new one reads the move in the history.
    expect(await call(getRequest, request.id, anaToken, undefined, "GET")).toMatchObject({ status: 404 });
    const seen = await call(getRequest, request.id, caioToken, undefined, "GET");
    expect(seen).toMatchObject({ status: 200, body: { assignee: null, history: { sectors: [{ to: { id: maintenance.id }, note: "Pedido é da manutenção", actor: { id: ana.id } }] } } });
  });
});

describe("a move reaches webhooks of either sector (SF-122; CA-SET-06)", () => {
  afterAll(() => {
    delete process.env.WEBHOOK_ENCRYPTION_KEY;
  });

  it("registers deliveries for webhooks of the origin, of the destination and without filter", async () => {
    process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const { reception, maintenance, people, ana: admin, request } = await scenario();
    const webhook = (name: string, sectorIds: string[]) =>
      prisma.webhookEndpoint.create({
        data: {
          name,
          url: `https://hooks.exemplo.com/${name}`,
          eventTypes: ["request.sector_changed"],
          sectorIds,
          encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY!, "base64")),
        },
      });
    const everyone = await webhook("todos", []);
    const origin = await webhook("origem", [reception.id]);
    const destination = await webhook("destino", [maintenance.id]);
    const other = await webhook("outro", [people.id]);

    // The request is already in the destination when the event is processed.
    await prisma.request.update({ where: { id: request.id }, data: { sectorId: maintenance.id } });
    const event: ClaimedEvent = {
      id: "7b6e8f00-0000-4000-8000-000000000001",
      type: "request.sector_changed",
      requestId: request.id,
      payload: { fromSectorId: reception.id, toSectorId: maintenance.id, actorId: admin.id },
      occurredAt: new Date(),
      attempts: 0,
    };
    await webhookConsumer(prisma).handle(event);

    const deliveries = await prisma.webhookDelivery.findMany({ where: { eventId: event.id }, select: { endpointId: true, body: true } });
    expect(deliveries.map(({ endpointId }) => endpointId).sort()).toEqual(
      [everyone.id, origin.id, destination.id].sort(),
    );
    expect(deliveries.map(({ endpointId }) => endpointId)).not.toContain(other.id);
    const body = deliveries[0]!.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toMatchObject({
      type: "request.sector_changed",
      requestId: request.id,
      data: { fromSectorId: reception.id, toSectorId: maintenance.id, actorId: admin.id },
    });
  });
});
