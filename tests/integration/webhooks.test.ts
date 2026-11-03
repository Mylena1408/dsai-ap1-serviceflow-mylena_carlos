import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { generateApiToken, purgeApiRateWindows, purgeEndedApiTokens } from "@/modules/api-tokens";
import { exportPersonalData } from "@/modules/audit";
import { recordOutboxEvent, type ClaimedEvent } from "@/modules/events";
import { anonymizeUser, setUserActive } from "@/modules/users";
import {
  createWebhook,
  getWebhookOverview,
  purgeWebhookDeliveries,
  rotateWebhookSecret,
  runWebhookDeliveries,
  setWebhookActive,
  updateWebhook,
  webhookConsumer,
} from "@/modules/webhooks";
import { ConflictError } from "@/server/errors";
import { createMemoryDocumentStorage } from "@/server/storage";

// SPEC 2026-11-02-api-externa-webhooks, 5.6 and 5.7 (SF-114; CA-API-10, 11 and 12), with a real
// HTTP receiver on this machine (WEBHOOK_ALLOW_LOCAL, accepted only outside production).

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let base = "";
const received: Received[] = [];
const answers: number[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ path: request.url ?? "", headers: request.headers, body });
      const status = answers.shift() ?? 204;
      response.writeHead(status, status === 302 ? { location: "http://127.0.0.1:1/elsewhere" } : {});
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.WEBHOOK_ENCRYPTION_KEY;
  delete process.env.WEBHOOK_ALLOW_LOCAL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function actAs(user: Pick<User, "id" | "name" | "email" | "role" | "sectorId">) {
  session.getCurrentUser.mockResolvedValue({ ...user, isActive: true });
}

async function openedEvent(): Promise<ClaimedEvent> {
  const requester = await createDomainUser({ role: "REQUESTER" });
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  await prisma.$transaction((transaction) =>
    recordOutboxEvent(transaction, {
      type: "request.opened",
      requestId: request.id,
      occurredAt: new Date(),
      payload: { requesterId: requester.id, sectorId: sector.id },
    }),
  );
  const row = await prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id } });
  return { id: row.id, type: "request.opened", requestId: request.id, payload: row.payload as Record<string, unknown>, occurredAt: row.occurredAt, attempts: 0 };
}

function verify(delivery: Received, secret: string): boolean {
  const [, timestamp, digest] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(delivery.headers["serviceflow-signature"])) ?? [];
  return createHmac("sha256", secret).update(`${timestamp}.${delivery.body}`).digest("hex") === digest;
}

describe("webhooks (SF-114)", () => {
  let admin: User;

  beforeEach(async () => {
    vi.clearAllMocks();
    received.length = 0;
    answers.length = 0;
    process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.WEBHOOK_ALLOW_LOCAL = "true";
    admin = await createDomainUser({ role: "ADMIN" });
    actAs(admin);
  });

  it("is not configured without the key: nothing is created (CA-API-10)", async () => {
    delete process.env.WEBHOOK_ENCRYPTION_KEY;

    await expect(getWebhookOverview(prisma)).resolves.toMatchObject({ configured: false, webhooks: [], deliveries: [] });
    await expect(createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma)).rejects.toThrow(ConflictError);
    await expect(prisma.webhookEndpoint.count()).resolves.toBe(0);
  });

  it("delivers each subscribed event once, signed, with only identifiers and codes (CA-API-11)", async () => {
    const { webhook, secret } = await createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma);
    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: webhook.id } });
    expect(stored.encryptedSecret).not.toContain(secret.slice(6));

    const event = await openedEvent();
    const consumer = webhookConsumer(prisma);
    await consumer.handle(event);
    await consumer.handle(event); // the outbox delivers at least once
    await consumer.handle({ ...event, id: "6a1f6f0e-6f6e-4c3b-9d5d-6a4b8a7a2f10", type: "request.status_changed" });
    await expect(prisma.webhookDelivery.count()).resolves.toBe(1);

    await expect(runWebhookDeliveries({}, prisma)).resolves.toEqual({ delivered: 1, retried: 0, failed: 0, cancelled: 0 });
    expect(received).toHaveLength(1);
    const [delivery] = received;
    expect(delivery!.path).toBe("/hook");
    expect(delivery!.headers).toMatchObject({ "content-type": "application/json", "serviceflow-event": "request.opened" });
    expect(verify(delivery!, secret)).toBe(true);
    expect(JSON.parse(delivery!.body)).toEqual({
      id: event.id,
      type: "request.opened",
      occurredAt: event.occurredAt.toISOString(),
      requestId: event.requestId,
      data: event.payload,
    });
    expect(delivery!.body).not.toContain("Domain fixture request");
    const saved = await prisma.webhookDelivery.findFirstOrThrow();
    expect(saved).toMatchObject({ status: "DELIVERED", attempts: 1, lastErrorCode: null });
    expect(delivery!.headers["serviceflow-delivery"]).toBe(saved.id);
  });

  it("retries failures by code, refuses redirects and cancels the pending deliveries of a deactivated webhook", async () => {
    const { webhook } = await createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma);
    await webhookConsumer(prisma).handle(await openedEvent());
    await webhookConsumer(prisma).handle(await openedEvent());
    answers.push(500, 302);

    await expect(runWebhookDeliveries({}, prisma)).resolves.toEqual({ delivered: 0, retried: 2, failed: 0, cancelled: 0 });
    const codes = (await prisma.webhookDelivery.findMany({ orderBy: { createdAt: "asc" } })).map(({ status, attempts, lastErrorCode }) => ({ status, attempts, lastErrorCode }));
    expect(codes).toEqual([
      { status: "PENDING", attempts: 1, lastErrorCode: "HTTP_500" },
      { status: "PENDING", attempts: 1, lastErrorCode: "REDIRECT" },
    ]);
    // The redirect was not followed: only the two original calls reached the receiver.
    expect(received.map(({ path }) => path)).toEqual(["/hook", "/hook"]);

    await setWebhookActive({ webhookId: webhook.id, isActive: false }, prisma);
    await expect(prisma.webhookDelivery.count({ where: { status: "CANCELLED" } })).resolves.toBe(2);
    await webhookConsumer(prisma).handle(await openedEvent());
    await expect(prisma.webhookDelivery.count()).resolves.toBe(2);
  });

  it("refuses an address that resolves to an internal network when local receivers are not allowed", async () => {
    const { webhook } = await createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma);
    await webhookConsumer(prisma).handle(await openedEvent());
    // The URL was accepted while local receivers were allowed; the check is repeated on sending.
    process.env.WEBHOOK_ALLOW_LOCAL = "false";
    await prisma.webhookEndpoint.update({ where: { id: webhook.id }, data: { url: `${base.replace("127.0.0.1", "localhost")}/hook` } });

    await runWebhookDeliveries({}, prisma);
    expect(received).toEqual([]);
    await expect(prisma.webhookDelivery.findFirstOrThrow()).resolves.toMatchObject({ lastErrorCode: "BLOCKED_ADDRESS" });
  });

  it("records every change in the audit without the secret, and keeps at most 10 active (CA-API-10, 12)", async () => {
    const { webhook, secret } = await createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma);
    await updateWebhook({ webhookId: webhook.id, name: "Portal novo", url: `${base}/novo`, eventTypes: ["request.opened", "request.comment_added"] }, prisma);
    const rotated = await rotateWebhookSecret({ webhookId: webhook.id }, prisma);
    await setWebhookActive({ webhookId: webhook.id, isActive: false }, prisma);

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "WEBHOOK" }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action }) => action)).toEqual(["CREATED", "UPDATED", "SECRET_ROTATED", "DEACTIVATED"]);
    const text = JSON.stringify(entries);
    for (const forbidden of [secret, rotated.secret, "encryptedSecret", "whsec_"]) expect(text).not.toContain(forbidden);

    for (let index = 0; index < 10; index += 1) {
      await createWebhook({ name: `Webhook ${index}`, url: `${base}/${index}`, eventTypes: ["request.opened"] }, prisma);
    }
    await expect(createWebhook({ name: "11º", url: `${base}/11`, eventTypes: ["request.opened"] }, prisma)).rejects.toThrow(ConflictError);
    await expect(setWebhookActive({ webhookId: webhook.id, isActive: true }, prisma)).rejects.toThrow(ConflictError);
  });

  it("applies the retention of deliveries, call windows and ended tokens (5.7)", async () => {
    const { webhook } = await createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma);
    const old = new Date("2026-09-01T12:00:00.000Z");
    const cutoff = new Date("2026-10-03T12:00:00.000Z");
    const delivery = (status: "DELIVERED" | "FAILED" | "PENDING", createdAt: Date) =>
      prisma.webhookDelivery.create({
        data: {
          endpointId: webhook.id,
          eventId: crypto.randomUUID(),
          eventType: "request.opened",
          body: "{}",
          status,
          createdAt,
          availableAt: createdAt,
          ...(status === "DELIVERED" ? { deliveredAt: createdAt } : {}),
        },
      });
    await delivery("DELIVERED", old);
    await delivery("FAILED", old);
    await delivery("PENDING", old);
    await delivery("DELIVERED", new Date("2026-10-20T12:00:00.000Z"));
    await expect(purgeWebhookDeliveries(cutoff, prisma)).resolves.toBe(2);
    await expect(prisma.webhookDelivery.count()).resolves.toBe(2);

    const owner = await createDomainUser({ role: "REQUESTER" });
    const token = async (overrides: object) => {
      const generated = generateApiToken();
      return prisma.apiToken.create({
        data: { userId: owner.id, name: "T", scope: "READ", tokenHash: generated.hash, lastFour: generated.lastFour, createdAt: new Date("2024-01-01T00:00:00.000Z"), expiresAt: new Date("2027-01-01T00:00:00.000Z"), ...overrides },
      });
    };
    const revoked = await token({ revokedAt: new Date("2025-01-01T00:00:00.000Z"), revokedById: admin.id });
    await token({ expiresAt: new Date("2024-12-31T00:00:00.000Z") });
    const active = await token({});
    await prisma.apiRateWindow.createMany({
      data: [
        { tokenId: active.id, windowStart: new Date("2026-11-01T10:00:00.000Z"), count: 3 },
        { tokenId: active.id, windowStart: new Date("2026-11-02T14:00:00.000Z"), count: 3 },
        { tokenId: revoked.id, windowStart: new Date("2026-11-02T14:00:00.000Z"), count: 1 },
      ],
    });

    await expect(purgeApiRateWindows(new Date("2026-11-01T15:00:00.000Z"), prisma)).resolves.toBe(1);
    await expect(purgeEndedApiTokens(new Date("2025-11-02T15:00:00.000Z"), prisma)).resolves.toBe(2);
    await expect(prisma.apiToken.findMany({ select: { id: true } })).resolves.toEqual([{ id: active.id }]);
    await expect(prisma.apiRateWindow.count()).resolves.toBe(1);
  });

  it("lists the person's tokens in \"Meus dados\" without value or hash, and anonymization revokes them (CA-API-12)", async () => {
    const owner = await prisma.user.create({ data: { name: "Bruno Lima", email: "bruno@exemplo.test", role: "REQUESTER", passwordHash: "!teste" } });
    const generated = generateApiToken();
    await prisma.apiToken.create({
      data: { userId: owner.id, name: "Planilha", scope: "WRITE", tokenHash: generated.hash, lastFour: generated.lastFour, createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
    });

    actAs(owner);
    const { content: text } = await exportPersonalData(prisma);
    expect(JSON.parse(text).tokensDeAcessoAPI).toEqual([
      expect.objectContaining({ nome: "Planilha", escopo: "Leitura e escrita", terminaEm: generated.lastFour, revogadoEm: null }),
    ]);
    expect(text).not.toContain(generated.value);
    expect(text).not.toContain(generated.hash);

    actAs(admin);
    await setUserActive(owner.id, false, prisma);
    await anonymizeUser({ userId: owner.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    await expect(prisma.apiToken.findFirstOrThrow({ where: { userId: owner.id } })).resolves.toMatchObject({ revokedById: admin.id });
    expect((await prisma.apiToken.findFirstOrThrow({ where: { userId: owner.id } })).revokedAt).not.toBeNull();
  });
});
