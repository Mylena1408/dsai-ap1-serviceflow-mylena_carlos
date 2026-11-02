import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainUser } from "./domain-fixtures";
import { generateApiToken } from "@/modules/api-tokens";
import { encryptWebhookSecret, generateWebhookSecret } from "@/modules/webhooks";

// SPEC 2026-11-02-api-externa-webhooks, section 6 (SF-111; CA-API-01 and 13: additive migration,
// no token and no webhook exists until someone creates one).

const now = new Date("2026-11-02T15:00:00.000Z");
const later = new Date("2027-01-31T15:00:00.000Z");

async function tokenRow(userId: string, overrides: Record<string, unknown> = {}) {
  const token = generateApiToken();
  return prisma.apiToken.create({
    data: {
      userId,
      name: "Portal",
      scope: "READ",
      tokenHash: token.hash,
      lastFour: token.lastFour,
      createdAt: now,
      expiresAt: later,
      ...overrides,
    },
  });
}

function webhookRow(overrides: Record<string, unknown> = {}) {
  return prisma.webhookEndpoint.create({
    data: {
      name: "Portal",
      url: "https://hooks.exemplo.com/serviceflow",
      eventTypes: ["request.opened"],
      encryptedSecret: encryptWebhookSecret(generateWebhookSecret(), randomBytes(32)),
      ...overrides,
    },
  });
}

describe("API token and webhook schema (SF-111)", () => {
  it("starts with no token, call window, webhook or delivery", async () => {
    await createDomainUser({ role: "REQUESTER" });

    await expect(prisma.apiToken.count()).resolves.toBe(0);
    await expect(prisma.apiRateWindow.count()).resolves.toBe(0);
    await expect(prisma.webhookEndpoint.count()).resolves.toBe(0);
    await expect(prisma.webhookDelivery.count()).resolves.toBe(0);
  });

  it("keeps only the hash of a token, once, with a valid name, expiry and revocation", async () => {
    const owner = await createDomainUser({ role: "REQUESTER" });
    const admin = await createDomainUser({ role: "ADMIN" });
    const saved = await tokenRow(owner.id);

    expect(saved).toMatchObject({ lastUsedAt: null, revokedAt: null, revokedById: null });
    await expect(tokenRow(owner.id, { tokenHash: saved.tokenHash })).rejects.toThrow();

    for (const overrides of [
      { name: " Portal" },
      { name: "" },
      { name: "x".repeat(61) },
      { tokenHash: "não-é-sha256" },
      { lastFour: "abc" },
      { expiresAt: now },
      { revokedAt: now },
      { revokedById: admin.id },
    ]) {
      await expect(tokenRow(owner.id, overrides), JSON.stringify(overrides)).rejects.toThrow();
    }

    await expect(
      prisma.apiToken.update({ where: { id: saved.id }, data: { revokedAt: now, revokedById: admin.id } }),
    ).resolves.toMatchObject({ revokedById: admin.id });
  });

  it("counts calls once per token and minute, and the windows go with the token", async () => {
    const owner = await createDomainUser({ role: "ATTENDANT", sectorId: (await prisma.sector.create({ data: { name: "TI" } })).id });
    const token = await tokenRow(owner.id);
    const window = { tokenId: token.id, windowStart: now };

    await prisma.apiRateWindow.create({ data: { ...window, count: 1 } });
    await expect(prisma.apiRateWindow.create({ data: { ...window, count: 1 } })).rejects.toThrow();
    await expect(prisma.apiRateWindow.create({ data: { tokenId: token.id, windowStart: later, count: 0 } })).rejects.toThrow();

    await prisma.apiToken.delete({ where: { id: token.id } });
    await expect(prisma.apiRateWindow.count()).resolves.toBe(0);
  });

  it("accepts webhooks with a valid name, URL and at least one known event type", async () => {
    await expect(webhookRow()).resolves.toMatchObject({ isActive: true });

    for (const overrides of [
      { name: "" },
      { name: "Portal " },
      { url: "" },
      { url: `https://a.com/${"x".repeat(2000)}` },
      { eventTypes: [] },
      { eventTypes: ["request.opened", "request.deleted"] },
    ]) {
      await expect(webhookRow(overrides), JSON.stringify(overrides).slice(0, 80)).rejects.toThrow();
    }
  });

  it("keeps one delivery per event and webhook, delivered only with a date, up to 6 attempts", async () => {
    const webhook = await webhookRow();
    const eventId = "6a1f6f0e-6f6e-4c3b-9d5d-6a4b8a7a2f10";
    const deliver = (overrides: Record<string, unknown> = {}) =>
      prisma.webhookDelivery.create({
        data: {
          endpointId: webhook.id,
          eventId,
          eventType: "request.opened",
          body: { id: eventId },
          availableAt: now,
          createdAt: now,
          ...overrides,
        },
      });

    await expect(deliver()).resolves.toMatchObject({ status: "PENDING", attempts: 0, deliveredAt: null });
    await expect(deliver()).rejects.toThrow();

    const other = { eventId: "0b0a5c0e-1d2e-4f3a-8b9c-0d1e2f3a4b5c" };
    await expect(deliver({ ...other, status: "DELIVERED" })).rejects.toThrow();
    await expect(deliver({ ...other, deliveredAt: now })).rejects.toThrow();
    await expect(deliver({ ...other, attempts: 7 })).rejects.toThrow();
    await expect(deliver({ ...other, lastErrorCode: "" })).rejects.toThrow();
    await expect(deliver({ ...other, status: "DELIVERED", deliveredAt: now, attempts: 1 })).resolves.toBeTruthy();

    // Deliveries keep their webhook: webhooks are deactivated, never deleted.
    await expect(prisma.webhookEndpoint.delete({ where: { id: webhook.id } })).rejects.toThrow();
  });
});
