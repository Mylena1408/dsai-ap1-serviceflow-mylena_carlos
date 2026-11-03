import { describe, expect, it, vi } from "vitest";
import type { ClaimedEvent } from "@/modules/events";
import { eventSectorIds, WEBHOOK_EVENT_LABELS } from "@/modules/webhooks/domain/delivery";
import { createWebhookConsumer } from "@/modules/webhooks/application/webhook-delivery";
import type { WebhookDeliveryStore } from "@/modules/webhooks/application/ports";

// SPEC 2026-11-03-transferencia-entre-setores, 5.7 (SF-122; decision T6).

const now = new Date("2026-11-03T12:00:00.000Z");

describe("sectors of an event for the webhook filter", () => {
  it("puts a move in its origin and destination, and every other event in the current sector", () => {
    expect(eventSectorIds("request.sector_changed", { fromSectorId: "s1", toSectorId: "s2", actorId: "a" })).toEqual(["s1", "s2"]);
    expect(eventSectorIds("request.opened", { requesterId: "r", sectorId: "s1" })).toBeNull();
    expect(WEBHOOK_EVENT_LABELS["request.sector_changed"]).toBe("Mudança de setor");
  });

  it("delivers a move to webhooks of either sector without reading the request", async () => {
    const registered: string[] = [];
    const requestSector = vi.fn(async () => "s2");
    const store = {
      subscribers: async () => [
        { id: "all", sectorIds: [] },
        { id: "origin", sectorIds: ["s1"] },
        { id: "destination", sectorIds: ["s2"] },
        { id: "other", sectorIds: ["s3"] },
      ],
      requestSector,
      register: async (rows: Array<{ endpointId: string }>) => {
        registered.push(...rows.map(({ endpointId }) => endpointId));
      },
    } as unknown as WebhookDeliveryStore;
    const event: ClaimedEvent = {
      id: "e1",
      type: "request.sector_changed",
      requestId: "r1",
      payload: { fromSectorId: "s1", toSectorId: "s2", actorId: "a" },
      occurredAt: now,
      attempts: 0,
    };

    await createWebhookConsumer(store, () => true).handle(event);

    expect(registered).toEqual(["all", "origin", "destination"]);
    expect(requestSector).not.toHaveBeenCalled();
  });
});
