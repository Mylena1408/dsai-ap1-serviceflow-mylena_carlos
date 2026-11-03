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

import { listAuditTrail } from "@/modules/audit";
import { recordOutboxEvent, type ClaimedEvent } from "@/modules/events";
import {
  createWebhook,
  getWebhookOverview,
  resendWebhookDelivery,
  runWebhookDeliveries,
  setWebhookActive,
  updateWebhook,
  webhookConsumer,
} from "@/modules/webhooks";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2 and 5.3 (SF-118; CA-ACT-06 and 07), with a real
// HTTP receiver on this machine.

let server: Server;
let base = "";
const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
const answers: number[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.writeHead(answers.shift() ?? 204).end();
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

async function openedIn(sectorId: string): Promise<ClaimedEvent> {
  const requester = await createDomainUser({ role: "REQUESTER" });
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId });
  await prisma.$transaction((transaction) =>
    recordOutboxEvent(transaction, { type: "request.opened", requestId: request.id, occurredAt: new Date(), payload: { requesterId: requester.id, sectorId } }),
  );
  const row = await prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id } });
  return { id: row.id, type: "request.opened", requestId: request.id, payload: row.payload as Record<string, unknown>, occurredAt: row.occurredAt, attempts: 0 };
}

describe("webhooks by sector and resending (SF-118)", () => {
  let admin: User;

  beforeEach(async () => {
    received.length = 0;
    answers.length = 0;
    process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.WEBHOOK_ALLOW_LOCAL = "true";
    admin = await createDomainUser({ role: "ADMIN" });
    session.getCurrentUser.mockResolvedValue({ ...admin, isActive: true });
  });

  it("sends a sector's events only to the webhooks of that sector or of every sector (CA-ACT-06)", async () => {
    const maintenance = await createDomainSector();
    const people = await createDomainSector();
    const everyone = await createWebhook({ name: "Todos", url: `${base}/todos`, eventTypes: ["request.opened"] }, prisma);
    const onlyMaintenance = await createWebhook(
      { name: "Manutenção", url: `${base}/manutencao`, eventTypes: ["request.opened"], sectorIds: [maintenance.id] },
      prisma,
    );

    await webhookConsumer(prisma).handle(await openedIn(maintenance.id));
    await webhookConsumer(prisma).handle(await openedIn(people.id));
    const deliveries = await prisma.webhookDelivery.findMany({ select: { endpointId: true } });
    expect(deliveries.filter(({ endpointId }) => endpointId === everyone.webhook.id)).toHaveLength(2);
    expect(deliveries.filter(({ endpointId }) => endpointId === onlyMaintenance.webhook.id)).toHaveLength(1);

    await expect(
      createWebhook({ name: "Errado", url: `${base}/x`, eventTypes: ["request.opened"], sectorIds: ["0b0a5c0e-1d2e-4f3a-8b9c-0d1e2f3a4b5c"] }, prisma),
    ).rejects.toThrow(ValidationError);

    // The overview lists the sectors to choose and the sectors of each webhook.
    const overview = await getWebhookOverview(prisma);
    expect(overview.sectors.map(({ id }) => id)).toEqual(expect.arrayContaining([maintenance.id, people.id]));
    expect(overview.webhooks.find(({ id }) => id === onlyMaintenance.webhook.id)?.sectorIds).toEqual([maintenance.id]);
  });

  it("records the sectors in the audit by their names", async () => {
    const maintenance = await prisma.sector.create({ data: { name: "Manutenção predial" } });
    const { webhook } = await createWebhook({ name: "Portal", url: `${base}/p`, eventTypes: ["request.opened"] }, prisma);
    await updateWebhook({ webhookId: webhook.id, name: "Portal", url: `${base}/p`, eventTypes: ["request.opened"], sectorIds: [maintenance.id] }, prisma);

    const trail = await listAuditTrail({ entity: "WEBHOOK" }, prisma);
    const update = trail.items.find((item) => item.kind === "change" && item.action === "UPDATED");
    expect(update && update.kind === "change" ? update.changes : []).toEqual([{ field: "sectorIds", before: [], after: [maintenance.id] }]);
    expect(trail.names[maintenance.id]).toBe("Manutenção predial");
  });

  it("resends a failed delivery with the same identifier and a valid signature (CA-ACT-07)", async () => {
    const sector = await createDomainSector();
    const { webhook, secret } = await createWebhook({ name: "Portal", url: `${base}/hook`, eventTypes: ["request.opened"] }, prisma);
    await webhookConsumer(prisma).handle(await openedIn(sector.id));
    const delivery = await prisma.webhookDelivery.findFirstOrThrow();

    // A pending delivery cannot be resent.
    await expect(resendWebhookDelivery({ deliveryId: delivery.id }, prisma)).rejects.toThrow(ConflictError);

    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", attempts: 6, lastErrorCode: "HTTP_500" } });
    await resendWebhookDelivery({ deliveryId: delivery.id }, prisma);
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({
      status: "PENDING",
      attempts: 0,
      lastErrorCode: null,
    });

    await runWebhookDeliveries({}, prisma);
    expect(received).toHaveLength(1);
    expect(received[0]!.headers["serviceflow-delivery"]).toBe(delivery.id);
    const [, timestamp, digest] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(received[0]!.headers["serviceflow-signature"]))!;
    expect(createHmac("sha256", secret).update(`${timestamp}.${received[0]!.body}`).digest("hex")).toBe(digest);
    await expect(prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).resolves.toMatchObject({ status: "DELIVERED", attempts: 1 });

    // Delivered, or of an inactive webhook: no resending. The resend is not audited.
    await expect(resendWebhookDelivery({ deliveryId: delivery.id }, prisma)).rejects.toThrow(ConflictError);
    await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "CANCELLED", deliveredAt: null } });
    await setWebhookActive({ webhookId: webhook.id, isActive: false }, prisma);
    await expect(resendWebhookDelivery({ deliveryId: delivery.id }, prisma)).rejects.toThrow(ConflictError);
    await expect(prisma.auditEntry.count({ where: { entityType: "WEBHOOK" } })).resolves.toBe(2);
  });
});
