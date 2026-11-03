import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { DOMAIN_EVENT_TYPES } from "@/modules/events/domain/domain-event";
import type { ClaimedEvent } from "@/modules/events";
import { createWebhook, resendWebhookDelivery } from "@/modules/webhooks/application/webhook-admin";
import { createWebhookConsumer } from "@/modules/webhooks/application/webhook-delivery";
import type { WebhookDeliveryStore, WebhookTransaction } from "@/modules/webhooks/application/ports";

// SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2 and 5.3 (SF-118; CA-ACT-06 and 07).

const admin = { id: "11111111-1111-4111-8111-111111111111", role: "ADMIN" as const, sectorId: null, isActive: true };
const deliveryId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-03T12:00:00.000Z");
const settings = { key: Buffer.alloc(32, 1), address: {}, eventTypes: DOMAIN_EVENT_TYPES };

function memory(delivery: { status: string; active: boolean } | null = null) {
  const writes: Array<{ kind: string; data: unknown }> = [];
  const transaction = {
    audited: async (_meta: unknown, change: () => Promise<unknown>) => change(),
    currentTime: async () => now,
    countActive: async () => 0,
    existingSectorIds: async () => ["s1", "s2"],
    insert: async (data: unknown) => (writes.push({ kind: "insert", data }), { id: "w1" }),
    find: async () => null,
    update: async () => ({ id: "w1" }),
    cancelPending: async () => 0,
    findDelivery: async (id: string) =>
      delivery && id === deliveryId ? { id, status: delivery.status, endpoint: { isActive: delivery.active } } : null,
    requeueDelivery: async (id: string, at: Date) => {
      writes.push({ kind: "requeue", data: { id, at } });
    },
  } as unknown as WebhookTransaction;
  return { deps: { transactions: { run: <T>(work: (t: WebhookTransaction) => Promise<T>) => work(transaction) }, settings }, writes };
}

describe("sectors of a webhook (CA-ACT-06)", () => {
  beforeEach(() => authorization.requireConfigurationAdministrator.mockResolvedValue(admin));

  it("keeps the chosen sectors and refuses an unknown one; none chosen means every sector", async () => {
    const form = { name: "Portal", url: "https://hooks.exemplo.com/sf", eventTypes: ["request.opened"] };
    const chosen = memory();
    await createWebhook({ ...form, sectorIds: ["s2", "s2"] }, chosen.deps);
    expect(chosen.writes[0]!.data).toMatchObject({ sectorIds: ["s2"] });

    const none = memory();
    await createWebhook(form, none.deps);
    expect(none.writes[0]!.data).toMatchObject({ sectorIds: [] });

    await expect(createWebhook({ ...form, sectorIds: ["s9"] }, memory().deps)).rejects.toThrow(ValidationError);
  });

  it("records deliveries only for webhooks that accept the request's sector", async () => {
    const registered: Array<{ endpointId: string }> = [];
    const requestSector = vi.fn(async () => "s1");
    const store = {
      subscribers: async () => [
        { id: "all", sectorIds: [] },
        { id: "s1-only", sectorIds: ["s1"] },
        { id: "s2-only", sectorIds: ["s2"] },
      ],
      requestSector,
      register: async (rows: Array<{ endpointId: string }>) => {
        registered.push(...rows);
      },
    } as unknown as WebhookDeliveryStore;
    const event: ClaimedEvent = { id: "e1", type: "request.opened", requestId: "r1", payload: {}, occurredAt: now, attempts: 0 };

    await createWebhookConsumer(store, () => true).handle(event);
    expect(registered.map(({ endpointId }) => endpointId)).toEqual(["all", "s1-only"]);

    // Without any filtering webhook, the sector is not even read.
    const plain = { ...store, subscribers: async () => [{ id: "all", sectorIds: [] }] } as unknown as WebhookDeliveryStore;
    requestSector.mockClear();
    await createWebhookConsumer(plain, () => true).handle(event);
    expect(requestSector).not.toHaveBeenCalled();
  });
});

describe("resending a delivery (CA-ACT-07)", () => {
  beforeEach(() => authorization.requireConfigurationAdministrator.mockResolvedValue(admin));

  it("puts a failed or cancelled delivery of an active webhook back in the queue", async () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      const { deps, writes } = memory({ status, active: true });
      await resendWebhookDelivery({ deliveryId }, deps);
      expect(writes).toEqual([{ kind: "requeue", data: { id: deliveryId, at: now } }]);
    }
  });

  it("refuses pending or delivered deliveries, inactive webhooks and unknown deliveries", async () => {
    for (const delivery of [{ status: "PENDING", active: true }, { status: "DELIVERED", active: true }, { status: "FAILED", active: false }]) {
      await expect(resendWebhookDelivery({ deliveryId }, memory(delivery).deps), JSON.stringify(delivery)).rejects.toThrow(ConflictError);
    }
    await expect(resendWebhookDelivery({ deliveryId }, memory(null).deps)).rejects.toThrow(NotFoundError);
    await expect(resendWebhookDelivery({ deliveryId: "nao-e-id" }, memory(null).deps)).rejects.toThrow(ValidationError);
  });
});
