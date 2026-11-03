import { createHmac, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { DOMAIN_EVENT_TYPES } from "@/modules/events/domain/domain-event";
import type { ClaimedEvent } from "@/modules/events";
import type { AuditMeta } from "@/modules/audit";
import { createWebhook, rotateWebhookSecret, setWebhookActive, updateWebhook, type WebhookSettings } from "@/modules/webhooks/application/webhook-admin";
import { createWebhookConsumer, processWebhookDeliveries } from "@/modules/webhooks/application/webhook-delivery";
import type { PendingWebhookDelivery, WebhookDeliveryStore, WebhookDeliveryUpdate, WebhookRecord, WebhookTransaction } from "@/modules/webhooks/application/ports";
import { createHttpWebhookTransport, webhookEnvironment } from "@/modules/webhooks/infrastructure/http-webhook-transport";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/modules/webhooks";

// SPEC 2026-11-02-api-externa-webhooks, 5.6 and 5.7 (SF-114; CA-API-10, 11 and 12).

const admin = { id: "11111111-1111-4111-8111-111111111111", role: "ADMIN" as const, sectorId: null, isActive: true };
const webhookId = "22222222-2222-4222-8222-222222222222";
const key = randomBytes(32);
const now = new Date("2026-11-02T15:00:00.000Z");
const settings: WebhookSettings = { key, address: {}, eventTypes: DOMAIN_EVENT_TYPES };
const form = { name: "Portal", url: "https://hooks.exemplo.com/sf", eventTypes: ["request.status_changed", "request.opened"] };

function memory(state: { active?: number; webhook?: Partial<WebhookRecord> | null } = {}) {
  const audits: AuditMeta[] = [];
  const writes: Array<{ kind: string; data: unknown }> = [];
  const existing: WebhookRecord | null =
    state.webhook === null
      ? null
      : { id: webhookId, name: "Portal", url: form.url, eventTypes: ["request.opened"], isActive: true, createdAt: now, updatedAt: now, ...state.webhook };
  const transaction: WebhookTransaction = {
    async audited(meta, change) {
      audits.push(meta);
      return change();
    },
    currentTime: async () => now,
    countActive: async () => state.active ?? 0,
    insert: async (data) => {
      writes.push({ kind: "insert", data });
      return { id: webhookId };
    },
    find: async (id) => (id === webhookId ? existing : null),
    update: async (id, data) => {
      writes.push({ kind: "update", data });
      return { id };
    },
    cancelPending: async () => {
      writes.push({ kind: "cancel", data: webhookId });
      return 2;
    },
  };
  return { deps: { transactions: { run: <T>(work: (t: WebhookTransaction) => Promise<T>) => work(transaction) }, settings }, audits, writes };
}

describe("webhook administration (CA-API-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireConfigurationAdministrator.mockResolvedValue(admin);
  });

  it("creates with the secret shown once and stored only encrypted, in the outbox order", async () => {
    const { deps, audits, writes } = memory();
    const created = await createWebhook(form, deps);

    expect(created.secret).toMatch(/^whsec_/);
    const inserted = writes[0]!.data as { encryptedSecret: string; eventTypes: string[]; url: string };
    expect(inserted.eventTypes).toEqual(["request.opened", "request.status_changed"]);
    expect(inserted.encryptedSecret).not.toContain(created.secret.slice(6));
    expect(decryptWebhookSecret(inserted.encryptedSecret, key)).toBe(created.secret);
    expect(audits).toEqual([{ actor: admin, action: "CREATED", entityType: "WEBHOOK" }]);
  });

  it("refuses without the key, above 10 active, with a refused URL or no event", async () => {
    await expect(createWebhook(form, { ...memory().deps, settings: { ...settings, key: null } })).rejects.toThrow(ConflictError);
    await expect(createWebhook(form, memory({ active: 10 }).deps)).rejects.toThrow(ConflictError);
    for (const input of [{ ...form, url: "http://hooks.exemplo.com" }, { ...form, url: "https://10.0.0.1/x" }, { ...form, eventTypes: [] }, { ...form, eventTypes: ["request.deleted"] }, { ...form, name: "" }, { ...form, extra: 1 }]) {
      await expect(createWebhook(input, memory().deps), JSON.stringify(input)).rejects.toThrow(ValidationError);
    }
  });

  it("updates, deactivates (cancelling pending deliveries) and rotates the secret with an audit entry", async () => {
    const update = memory();
    await updateWebhook({ webhookId, ...form, name: "Portal novo" }, update.deps);
    expect(update.audits).toEqual([{ actor: admin, action: "UPDATED", entityType: "WEBHOOK", entityId: webhookId }]);

    const deactivate = memory();
    await setWebhookActive({ webhookId, isActive: false }, deactivate.deps);
    expect(deactivate.writes.map(({ kind }) => kind)).toEqual(["update", "cancel"]);
    expect(deactivate.audits[0]).toMatchObject({ action: "DEACTIVATED" });

    const same = memory();
    await setWebhookActive({ webhookId, isActive: true }, same.deps);
    expect(same.writes).toEqual([]);
    await expect(setWebhookActive({ webhookId, isActive: true }, memory({ active: 10, webhook: { isActive: false } }).deps)).rejects.toThrow(ConflictError);

    const rotate = memory();
    const rotated = await rotateWebhookSecret({ webhookId }, rotate.deps);
    expect(decryptWebhookSecret((rotate.writes[0]!.data as { encryptedSecret: string }).encryptedSecret, key)).toBe(rotated.secret);
    expect(rotate.audits).toEqual([{ actor: admin, action: "SECRET_ROTATED", entityType: "WEBHOOK", entityId: webhookId }]);

    await expect(rotateWebhookSecret({ webhookId: "33333333-3333-4333-8333-333333333333" }, memory().deps)).rejects.toThrow(NotFoundError);
  });
});

describe("webhook deliveries (CA-API-11)", () => {
  const event: ClaimedEvent = {
    id: "44444444-4444-4444-8444-444444444444",
    type: "request.opened",
    requestId: "55555555-5555-4555-8555-555555555555",
    payload: { requesterId: "u1", sectorId: "s1" },
    occurredAt: now,
    attempts: 0,
  };

  function store(pending: PendingWebhookDelivery[] = []) {
    const registered: unknown[] = [];
    const saved: Array<{ id: string; update: WebhookDeliveryUpdate }> = [];
    const delivery: WebhookDeliveryStore = {
      subscribers: async (type) => (type === "request.opened" ? [{ id: "w1" }, { id: "w2" }] : []),
      register: async (rows) => {
        registered.push(...rows);
      },
      claimPending: async () => ({ deliveries: pending.splice(0), now }),
      save: async (id, update) => {
        saved.push({ id, update });
      },
    };
    return { delivery, registered, saved };
  }

  it("records one delivery per subscribing webhook with only the outbox content, nothing without the key", async () => {
    const configured = store();
    await createWebhookConsumer(configured.delivery, () => true).handle(event);
    expect(configured.registered).toEqual([
      expect.objectContaining({ endpointId: "w1", eventId: event.id, eventType: "request.opened" }),
      expect.objectContaining({ endpointId: "w2", eventId: event.id }),
    ]);
    expect(JSON.parse((configured.registered[0] as { body: string }).body)).toEqual({
      id: event.id,
      type: "request.opened",
      occurredAt: now.toISOString(),
      requestId: event.requestId,
      data: { requesterId: "u1", sectorId: "s1" },
    });

    const off = store();
    await createWebhookConsumer(off.delivery, () => false).handle(event);
    expect(off.registered).toEqual([]);
  });

  function pending(overrides: Partial<PendingWebhookDelivery> = {}): PendingWebhookDelivery {
    return {
      id: "d1",
      eventType: "request.opened",
      body: '{"id":"e1"}',
      attempts: 0,
      endpoint: { id: "w1", url: "https://hooks.exemplo.com/sf", isActive: true, encryptedSecret: encryptWebhookSecret("whsec_teste", key) },
      ...overrides,
    };
  }

  it("signs and sends, then records success, retry with the wait, final failure or cancellation", async () => {
    const posts: Array<{ url: string; signature: string; body: string }> = [];
    const answers = [{ kind: "response" as const, status: 204 }, { kind: "response" as const, status: 500 }, { kind: "timeout" as const }];
    const transport = { post: vi.fn(async (url: string, request: { signature: string; body: string }) => (posts.push({ url, ...request }), answers.shift()!)) };
    const { delivery, saved } = store([
      pending({ id: "ok" }),
      pending({ id: "retry" }),
      pending({ id: "last", attempts: 5 }),
      pending({ id: "inactive", endpoint: { ...pending().endpoint, isActive: false } }),
      pending({ id: "unreadable", endpoint: { ...pending().endpoint, encryptedSecret: encryptWebhookSecret("x", randomBytes(32)) } }),
    ]);

    const summary = await processWebhookDeliveries(delivery, { key, transport });

    const expected = createHmac("sha256", "whsec_teste").update(`${Math.floor(now.getTime() / 1000)}.{"id":"e1"}`).digest("hex");
    expect(posts[0]!.signature).toBe(`t=${Math.floor(now.getTime() / 1000)},v1=${expected}`);
    expect(saved).toEqual([
      { id: "ok", update: { status: "DELIVERED", attempts: 1, deliveredAt: now } },
      { id: "retry", update: { status: "PENDING", attempts: 1, availableAt: new Date(now.getTime() + 60_000), lastErrorCode: "HTTP_500" } },
      { id: "last", update: { status: "FAILED", attempts: 6, lastErrorCode: "TIMEOUT" } },
      { id: "inactive", update: { status: "CANCELLED" } },
      { id: "unreadable", update: { status: "PENDING", attempts: 1, availableAt: new Date(now.getTime() + 60_000), lastErrorCode: "SECRET_UNAVAILABLE" } },
    ]);
    expect(summary).toEqual({ delivered: 1, retried: 2, failed: 1, cancelled: 1 });
    expect(transport.post).toHaveBeenCalledTimes(3);
  });

  it("sends nothing without the key", async () => {
    const { delivery, saved } = store([pending()]);
    await expect(processWebhookDeliveries(delivery, null)).resolves.toEqual({ delivered: 0, retried: 0, failed: 0, cancelled: 0 });
    expect(saved).toEqual([]);
  });
});

describe("HTTP transport", () => {
  const request = { deliveryId: "d1", eventType: "request.opened", body: '{"id":"e1"}', signature: "t=1,v1=ab" };

  it("refuses names that resolve to internal addresses, without connecting", async () => {
    const send = vi.fn();
    for (const addresses of [["10.0.0.5"], ["8.8.8.8", "127.0.0.1"], []]) {
      const transport = createHttpWebhookTransport({}, async () => addresses, send as unknown as typeof fetch);
      await expect(transport.post("https://hooks.exemplo.com/sf", request)).resolves.toEqual({ kind: "blocked" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the signed body without following redirects and reports the status", async () => {
    const send = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://10.0.0.1" } }));
    const transport = createHttpWebhookTransport({}, async () => ["8.8.8.8"], send as unknown as typeof fetch);

    await expect(transport.post("https://hooks.exemplo.com/sf", request)).resolves.toEqual({ kind: "response", status: 302 });
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST", redirect: "manual", body: request.body });
    expect(init.headers).toMatchObject({ "ServiceFlow-Signature": "t=1,v1=ab", "ServiceFlow-Event": "request.opened", "ServiceFlow-Delivery": "d1" });
  });

  it("reports timeouts and network failures by kind", async () => {
    const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
    await expect(
      createHttpWebhookTransport({}, async () => ["8.8.8.8"], (async () => Promise.reject(timeout)) as unknown as typeof fetch).post("https://a.com", request),
    ).resolves.toEqual({ kind: "timeout" });
    await expect(
      createHttpWebhookTransport({}, async () => ["8.8.8.8"], (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch).post("https://a.com", request),
    ).resolves.toEqual({ kind: "network" });
    await expect(createHttpWebhookTransport({}, async () => Promise.reject(new Error("ENOTFOUND"))).post("https://a.com", request)).resolves.toEqual({ kind: "network" });
  });

  it("reads the key and never allows local receivers in production", () => {
    const raw = randomBytes(32).toString("base64");
    expect(webhookEnvironment({ WEBHOOK_ENCRYPTION_KEY: raw, WEBHOOK_ALLOW_LOCAL: "true", NODE_ENV: "development" })).toMatchObject({ address: { allowLocal: true } });
    expect(webhookEnvironment({ WEBHOOK_ENCRYPTION_KEY: raw, WEBHOOK_ALLOW_LOCAL: "true", NODE_ENV: "production" })).toMatchObject({ address: { allowLocal: false } });
    expect(webhookEnvironment({}).key).toBeNull();
  });
});
