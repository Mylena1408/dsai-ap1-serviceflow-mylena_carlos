import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";
import { encryptWebhookSecret, generateWebhookSecret } from "@/modules/webhooks";

// SPEC 2026-11-03-transferencia-entre-setores, section 6 (SF-120).

async function scenario() {
  const from = await createDomainSector();
  const to = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: from.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: from.id });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: from.id });
  return { from, to, attendant, request };
}

describe("request sector events schema (SF-120)", () => {
  it("records a move with a trimmed reason of 1 to 1,000 characters between different sectors", async () => {
    const { from, to, attendant, request } = await scenario();
    const event = (overrides: Record<string, unknown> = {}) =>
      prisma.requestSectorEvent.create({
        data: {
          requestId: request.id,
          actorId: attendant.id,
          fromSectorId: from.id,
          toSectorId: to.id,
          fromSectorName: from.name,
          toSectorName: to.name,
          note: "Pedido é de outro setor",
          occurredAt: new Date(),
          ...overrides,
        },
      });

    await expect(event()).resolves.toMatchObject({ note: "Pedido é de outro setor" });
    await expect(event({ note: "x".repeat(1_000) })).resolves.toBeTruthy();

    for (const overrides of [
      { note: "" },
      { note: " motivo" },
      { note: "x".repeat(1_001) },
      { toSectorId: from.id, toSectorName: from.name },
      { fromSectorName: "" },
      { toSectorName: "" },
    ]) {
      await expect(event(overrides), JSON.stringify(overrides).slice(0, 60)).rejects.toThrow();
    }
  });

  it("accepts request.sector_changed in the outbox and in webhooks, and nothing unknown", async () => {
    const { request } = await scenario();
    const outbox = (type: string) =>
      prisma.outboxEvent.create({ data: { type, requestId: request.id, occurredAt: new Date(), availableAt: new Date(), payload: {} } });
    await expect(outbox("request.sector_changed")).resolves.toBeTruthy();
    await expect(outbox("request.approval_decided")).resolves.toBeTruthy();
    await expect(outbox("request.sector_moved")).rejects.toThrow();

    const webhook = (eventTypes: string[]) =>
      prisma.webhookEndpoint.create({
        data: {
          name: "Portal",
          url: "https://hooks.exemplo.com/serviceflow",
          eventTypes,
          encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), randomBytes(32)),
        },
      });
    await expect(webhook(["request.opened", "request.sector_changed"])).resolves.toBeTruthy();
    await expect(webhook(["request.sector_moved"])).rejects.toThrow();
  });
});
