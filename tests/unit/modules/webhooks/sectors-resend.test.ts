import { describe, expect, it } from "vitest";
import { canResendWebhookDelivery, checkWebhookSectors, webhookAcceptsSector } from "@/modules/webhooks";

// SPEC 2026-11-03-api-acoes-webhooks-setor, 5.2 and 5.3 (SF-116; rules of CA-ACT-06 and 07).

describe("webhook sectors (W2)", () => {
  it("receives every sector when none is chosen, and only the chosen ones otherwise", () => {
    expect(webhookAcceptsSector([], "s1")).toBe(true);
    expect(webhookAcceptsSector(["s1", "s2"], "s2")).toBe(true);
    expect(webhookAcceptsSector(["s1"], "s3")).toBe(false);
  });

  it("keeps the chosen sectors once each and refuses an unknown one", () => {
    expect(checkWebhookSectors(["s2", "s1", "s2"], ["s1", "s2", "s3"])).toEqual(["s2", "s1"]);
    expect(checkWebhookSectors([], ["s1"])).toEqual([]);
    expect(checkWebhookSectors(["s9"], ["s1"])).toBeNull();
  });
});

describe("resending a delivery (W3)", () => {
  it("is allowed only for a failed or cancelled delivery of an active webhook", () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      expect(canResendWebhookDelivery({ status }, { isActive: true }), status).toBe(true);
      expect(canResendWebhookDelivery({ status }, { isActive: false }), status).toBe(false);
    }
    for (const status of ["PENDING", "DELIVERED"]) {
      expect(canResendWebhookDelivery({ status }, { isActive: true }), status).toBe(false);
    }
  });
});
