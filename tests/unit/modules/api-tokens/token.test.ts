import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_CALLS_PER_MINUTE,
  MAX_ACTIVE_API_TOKENS,
  apiTokenAllows,
  apiTokenCreationRefusal,
  apiTokenExpiry,
  bearerApiToken,
  canAuthenticateWithApiToken,
  generateApiToken,
  hashApiToken,
  isApiTokenActive,
  isApiTokenValidityDays,
  normalizeApiTokenName,
  rateDecision,
  rateWindowStart,
  shouldRecordApiTokenUse,
} from "@/modules/api-tokens";

// SPEC 2026-11-02-api-externa-webhooks, 5.1 to 5.5 (SF-111; rules of CA-API-02, 03, 04 and 08).

const now = new Date("2026-11-02T15:00:30.000Z");

describe("API token value", () => {
  it("is sf_ plus 32 random bytes, kept only as its SHA-256 and last four characters", () => {
    const token = generateApiToken(() => Buffer.alloc(32, 7));

    expect(token.value).toMatch(/^sf_[A-Za-z0-9_-]{43}$/);
    expect(token.hash).toBe(createHash("sha256").update(token.value).digest("hex"));
    expect(token.hash).toBe(hashApiToken(token.value));
    expect(token.lastFour).toBe(token.value.slice(-4));
  });

  it("differs on every generation with the real random source", () => {
    expect(generateApiToken().value).not.toBe(generateApiToken().value);
  });

  it("is read only from a well-formed Bearer header", () => {
    const { value } = generateApiToken();

    expect(bearerApiToken(`Bearer ${value}`)).toBe(value);
    for (const header of [null, undefined, "", value, `bearer ${value}`, `Bearer ${value} extra`, "Bearer sf_short", `Basic ${value}`, `Bearer xx_${value.slice(3)}`]) {
      expect(bearerApiToken(header)).toBeNull();
    }
  });
});

describe("API token rules", () => {
  it("expires 30, 90 or 365 days after creation", () => {
    expect(apiTokenExpiry(now, 30).toISOString()).toBe("2026-12-02T15:00:30.000Z");
    expect([30, 90, 365].every(isApiTokenValidityDays)).toBe(true);
    expect([0, 7, 366, "90", null].some(isApiTokenValidityDays)).toBe(false);
  });

  it("takes a trimmed name of 1 to 60 characters", () => {
    expect(normalizeApiTokenName("  Integração do portal  ")).toBe("Integração do portal");
    expect(normalizeApiTokenName("   ")).toBeNull();
    expect(normalizeApiTokenName("x".repeat(60))).toHaveLength(60);
    expect(normalizeApiTokenName("x".repeat(61))).toBeNull();
  });

  it("lets requesters, attendants and managers create up to 10 active tokens, not administrators (A1)", () => {
    const owner = { role: "REQUESTER" as const, isActive: true, anonymized: false, activeTokenCount: 0 };

    expect(apiTokenCreationRefusal(owner)).toBeNull();
    expect(apiTokenCreationRefusal({ ...owner, role: "ATTENDANT" })).toBeNull();
    expect(apiTokenCreationRefusal({ ...owner, role: "MANAGER", activeTokenCount: MAX_ACTIVE_API_TOKENS - 1 })).toBeNull();
    expect(apiTokenCreationRefusal({ ...owner, role: "ADMIN" })).toBe("role");
    expect(apiTokenCreationRefusal({ ...owner, isActive: false })).toBe("inactive");
    expect(apiTokenCreationRefusal({ ...owner, anonymized: true })).toBe("inactive");
    expect(apiTokenCreationRefusal({ ...owner, activeTokenCount: MAX_ACTIVE_API_TOKENS })).toBe("limit");
  });

  it("authenticates only an active token of an active, eligible owner (CA-API-03)", () => {
    const token = { expiresAt: new Date(now.getTime() + 1000), revokedAt: null };
    const owner = { role: "ATTENDANT" as const, isActive: true, anonymized: false };

    expect(isApiTokenActive(token, now)).toBe(true);
    expect(canAuthenticateWithApiToken(token, owner, now)).toBe(true);
    expect(canAuthenticateWithApiToken({ ...token, revokedAt: now }, owner, now)).toBe(false);
    expect(canAuthenticateWithApiToken({ ...token, expiresAt: now }, owner, now)).toBe(false);
    expect(canAuthenticateWithApiToken(token, { ...owner, isActive: false }, now)).toBe(false);
    expect(canAuthenticateWithApiToken(token, { ...owner, anonymized: true }, now)).toBe(false);
    // A change of profile to administrator cuts the access on the next call.
    expect(canAuthenticateWithApiToken(token, { ...owner, role: "ADMIN" }, now)).toBe(false);
  });

  it("lets a read-only token use only GET (A2, CA-API-04)", () => {
    expect(apiTokenAllows("READ", "GET")).toBe(true);
    expect(apiTokenAllows("READ", "POST")).toBe(false);
    expect(apiTokenAllows("WRITE", "GET")).toBe(true);
    expect(apiTokenAllows("WRITE", "post")).toBe(true);
  });

  it("records the last use at most once a minute", () => {
    expect(shouldRecordApiTokenUse(null, now)).toBe(true);
    expect(shouldRecordApiTokenUse(new Date(now.getTime() - 59_999), now)).toBe(false);
    expect(shouldRecordApiTokenUse(new Date(now.getTime() - 60_000), now)).toBe(true);
  });
});

describe("calls per minute (A6, CA-API-08)", () => {
  it("counts in fixed windows that start on the minute", () => {
    expect(rateWindowStart(now).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("allows 60 calls and asks to wait until the next window", () => {
    expect(rateDecision(API_CALLS_PER_MINUTE, now)).toEqual({ allowed: true });
    expect(rateDecision(API_CALLS_PER_MINUTE + 1, now)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(rateDecision(61, new Date("2026-11-02T15:00:59.900Z"))).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});
