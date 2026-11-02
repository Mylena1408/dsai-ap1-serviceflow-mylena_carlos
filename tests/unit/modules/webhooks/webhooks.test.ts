import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPES } from "@/modules/events/domain/domain-event";
import {
  MAX_WEBHOOK_ATTEMPTS,
  WEBHOOK_EVENT_LABELS,
  checkWebhookEvents,
  checkWebhookUrl,
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  isBlockedAddress,
  normalizeWebhookName,
  parseWebhookEncryptionKey,
  webhookBody,
  webhookFailureCode,
  webhookRetryPlan,
  webhookSignature,
} from "@/modules/webhooks";

// SPEC 2026-11-02-api-externa-webhooks, 5.6 (SF-111; rules of CA-API-10 and 11).

const now = new Date("2026-11-02T15:00:00.000Z");

describe("webhook address", () => {
  it("accepts HTTPS to public names on the default port, 443 or 8443", () => {
    expect(checkWebhookUrl(" https://hooks.exemplo.com.br/serviceflow?x=1 ")).toEqual({
      ok: true,
      url: "https://hooks.exemplo.com.br/serviceflow?x=1",
    });
    expect(checkWebhookUrl("https://hooks.exemplo.com.br:8443/a").ok).toBe(true);
    expect(checkWebhookUrl("https://8.8.8.8/a").ok).toBe(true);
  });

  it.each([
    ["", "invalid"],
    ["não é url", "invalid"],
    [`https://a.com/${"x".repeat(2000)}`, "invalid"],
    ["http://hooks.exemplo.com/a", "scheme"],
    ["ftp://hooks.exemplo.com/a", "scheme"],
    ["https://user:pass@hooks.exemplo.com/a", "credentials"],
    ["https://hooks.exemplo.com:8080/a", "port"],
    ["https://localhost/a", "host"],
    ["https://api.localhost/a", "host"],
    ["https://intranet/a", "host"],
    ["https://127.0.0.1/a", "host"],
    ["https://10.1.2.3/a", "host"],
    ["https://192.168.0.10/a", "host"],
    ["https://169.254.169.254/latest", "host"],
    ["https://[::1]/a", "host"],
    ["https://[fd00::1]/a", "host"],
  ])("refuses %s (%s)", (url, reason) => {
    expect(checkWebhookUrl(url)).toEqual({ ok: false, reason });
  });

  it("accepts plain HTTP to localhost only with the test option", () => {
    expect(checkWebhookUrl("http://127.0.0.1:4100/hook", { allowLocal: true }).ok).toBe(true);
    expect(checkWebhookUrl("http://localhost:4100/hook", { allowLocal: true }).ok).toBe(true);
    expect(checkWebhookUrl("http://10.0.0.1/hook", { allowLocal: true })).toEqual({ ok: false, reason: "scheme" });
    expect(checkWebhookUrl("http://127.0.0.1:4100/hook")).toEqual({ ok: false, reason: "scheme" });
  });

  it("blocks private, local, shared, documentation, multicast and reserved addresses", () => {
    const blocked = [
      "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.255.255",
      "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
      "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
      "não é ip",
    ];
    const allowed = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2800:3f0:4001:80b::200e", "::ffff:8.8.8.8"];

    for (const address of blocked) expect(isBlockedAddress(address), address).toBe(true);
    for (const address of allowed) expect(isBlockedAddress(address), address).toBe(false);
    expect(isBlockedAddress("127.0.0.1", { allowLocal: true })).toBe(false);
  });
});

describe("webhook secret", () => {
  const key = randomBytes(32);

  it("is whsec_ plus 32 random bytes", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });

  it("reads the key only when it has 32 bytes in base64", () => {
    expect(parseWebhookEncryptionKey(key.toString("base64"))?.equals(key)).toBe(true);
    for (const raw of [undefined, "", "curta", randomBytes(16).toString("base64"), "!!!não-é-base64!!!"]) {
      expect(parseWebhookEncryptionKey(raw)).toBeNull();
    }
  });

  it("is stored encrypted and comes back only with the same key, unchanged", () => {
    const secret = generateWebhookSecret();
    const stored = encryptWebhookSecret(secret, key);

    expect(stored).not.toContain(secret.slice(6));
    expect(encryptWebhookSecret(secret, key)).not.toBe(stored); // a new IV each time
    expect(decryptWebhookSecret(stored, key)).toBe(secret);
    expect(() => decryptWebhookSecret(stored, randomBytes(32))).toThrow();

    const [version, iv, tag, ciphertext] = stored.split(":");
    const changed = Buffer.from(ciphertext!, "base64url");
    changed[0] = changed[0]! ^ 1;
    expect(() => decryptWebhookSecret([version, iv, tag, changed.toString("base64url")].join(":"), key)).toThrow();
    expect(() => decryptWebhookSecret("v0:a:b:c", key)).toThrow();
  });

  it("signs the timestamp and the body with HMAC-SHA256", () => {
    const body = '{"id":"e1"}';
    const expected = createHmac("sha256", "whsec_x").update(`1762095600.${body}`).digest("hex");

    expect(webhookSignature(body, "whsec_x", 1762095600)).toBe(`t=1762095600,v1=${expected}`);
    expect(webhookSignature(body + " ", "whsec_x", 1762095600)).not.toBe(`t=1762095600,v1=${expected}`);
  });
});

describe("webhook registration and delivery", () => {
  it("has a name for every event type of the outbox", () => {
    expect(Object.keys(WEBHOOK_EVENT_LABELS).sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it("takes a trimmed name and at least one known event type, in the outbox order", () => {
    expect(normalizeWebhookName("  Portal  ")).toBe("Portal");
    expect(normalizeWebhookName("")).toBeNull();
    expect(checkWebhookEvents(["request.status_changed", "request.opened", "request.opened"], DOMAIN_EVENT_TYPES)).toEqual([
      "request.opened",
      "request.status_changed",
    ]);
    expect(checkWebhookEvents([], DOMAIN_EVENT_TYPES)).toBeNull();
    expect(checkWebhookEvents(["request.deleted"], DOMAIN_EVENT_TYPES)).toBeNull();
  });

  it("sends exactly the outbox content with a fixed key order", () => {
    const body = webhookBody({
      id: "e1",
      type: "request.status_changed",
      occurredAt: now,
      requestId: "r1",
      payload: { fromStatus: "OPEN", toStatus: "IN_PROGRESS", actorId: "u1" },
    });

    expect(body).toBe(
      '{"id":"e1","type":"request.status_changed","occurredAt":"2026-11-02T15:00:00.000Z","requestId":"r1",' +
        '"data":{"fromStatus":"OPEN","toStatus":"IN_PROGRESS","actorId":"u1"}}',
    );
  });

  it("treats only 2xx as success and records failures by code", () => {
    expect(webhookFailureCode({ kind: "response", status: 200 })).toBeNull();
    expect(webhookFailureCode({ kind: "response", status: 204 })).toBeNull();
    expect(webhookFailureCode({ kind: "response", status: 302 })).toBe("REDIRECT");
    expect(webhookFailureCode({ kind: "response", status: 500 })).toBe("HTTP_500");
    expect(webhookFailureCode({ kind: "timeout" })).toBe("TIMEOUT");
    expect(webhookFailureCode({ kind: "network" })).toBe("NETWORK");
    expect(webhookFailureCode({ kind: "blocked" })).toBe("BLOCKED_ADDRESS");
  });

  it("waits 1 min, 5 min, 30 min, 2 h and 12 h, then gives up after 6 attempts", () => {
    const waits = [1, 2, 3, 4, 5].map((attempts) => {
      const plan = webhookRetryPlan(attempts, now);
      return plan.status === "PENDING" ? (plan.availableAt.getTime() - now.getTime()) / 60_000 : null;
    });

    expect(waits).toEqual([1, 5, 30, 120, 720]);
    expect(webhookRetryPlan(MAX_WEBHOOK_ATTEMPTS, now)).toEqual({ status: "FAILED" });
  });
});
