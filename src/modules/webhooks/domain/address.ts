import { isIP } from "node:net";

// Where a webhook may point (SPEC 2026-11-02-api-externa-webhooks, 5.6; decision A5): HTTPS to a
// public address. The same address rule is applied again to every resolved address before
// each delivery.

export const WEBHOOK_URL_MAX_LENGTH = 2000;
const ALLOWED_HTTPS_PORTS = ["", "443", "8443"];

export type WebhookUrlRefusal = "invalid" | "scheme" | "credentials" | "port" | "host";
export type WebhookUrlCheck = { ok: true; url: string } | { ok: false; reason: WebhookUrlRefusal };

export interface WebhookAddressOptions {
  /** Only for the tests (`WEBHOOK_ALLOW_LOCAL=true`): accepts http(s)://localhost and 127.0.0.1. */
  allowLocal?: boolean;
}

const LOCAL_TEST_HOSTS = ["localhost", "127.0.0.1"];

function ipv4Parts(address: string): number[] {
  return address.split(".").map(Number);
}

function blockedIpv4(address: string): boolean {
  const [a = 0, b = 0, c = 0] = ipv4Parts(address);
  return (
    a === 0 || // "this" network
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // shared address space
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved and broadcast
  );
}

/** The eight 16-bit groups of an IPv6 address (with an embedded IPv4 tail converted). */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase().split("%")[0]!;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a = 0, b = 0, c = 0, d = 0] = ipv4Parts(tail[1]!);
    text = text.slice(0, -tail[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(rest === undefined ? 0 : missing).fill("0"), ...right].map((group) => parseInt(group, 16));
}

function blockedIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  const [g0 = 0, g1 = 0, , , , g5 = 0, g6 = 0, g7 = 0] = groups;

  if (groups.slice(0, 5).every((group) => group === 0) && g5 === 0xffff) {
    // IPv4-mapped: judged by the IPv4 address.
    return blockedIpv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`);
  }

  return (
    groups.every((group) => group === 0) || // unspecified
    (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) || // loopback
    (g0 & 0xfe00) === 0xfc00 || // unique local
    (g0 & 0xffc0) === 0xfe80 || // link-local
    (g0 & 0xff00) === 0xff00 || // multicast
    (g0 === 0x2001 && g1 === 0x0db8) || // documentation
    (g0 === 0x0064 && g1 === 0xff9b) // NAT64
  );
}

/** True for loopback, private, link-local, shared, documentation, multicast or reserved addresses. */
export function isBlockedAddress(address: string, options: WebhookAddressOptions = {}): boolean {
  if (options.allowLocal && (address === "127.0.0.1" || address === "::1")) return false;
  const version = isIP(address);
  if (version === 4) return blockedIpv4(address);
  if (version === 6) return blockedIpv6(address);
  return true;
}

/** Checks a webhook URL as typed by the administrator (5.6); the stored form is the normalized one. */
export function checkWebhookUrl(raw: string, options: WebhookAddressOptions = {}): WebhookUrlCheck {
  const text = raw.trim();
  if (text.length === 0 || text.length > WEBHOOK_URL_MAX_LENGTH) return { ok: false, reason: "invalid" };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localTest = Boolean(options.allowLocal) && LOCAL_TEST_HOSTS.includes(host);

  if (url.protocol !== "https:" && !(localTest && url.protocol === "http:")) return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (localTest) return { ok: true, url: url.toString() };
  if (!ALLOWED_HTTPS_PORTS.includes(url.port)) return { ok: false, reason: "port" };

  // Single-label names ("intranet") only resolve inside a private network.
  const isLocalName = host === "localhost" || host.endsWith(".localhost") || (!host.includes(".") && isIP(host) === 0);
  if (isLocalName || (isIP(host) !== 0 && isBlockedAddress(host))) return { ok: false, reason: "host" };

  return { ok: true, url: url.toString() };
}
