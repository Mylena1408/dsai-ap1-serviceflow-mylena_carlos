import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Signing secret of a webhook (SPEC 2026-11-02-api-externa-webhooks, 5.6; decision A5): generated
// by the server, shown once, stored encrypted with AES-256-GCM under a key that lives only in
// WEBHOOK_ENCRYPTION_KEY, and used for an HMAC-SHA256 signature of every delivery.

export const WEBHOOK_SECRET_PREFIX = "whsec_";
const SECRET_BYTES = 32;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

export function generateWebhookSecret(random: (size: number) => Buffer = randomBytes): string {
  return WEBHOOK_SECRET_PREFIX + random(SECRET_BYTES).toString("base64url");
}

/**
 * The encryption key from its environment value (32 bytes in base64), or null when absent or
 * invalid: then webhooks are "not configured" and nothing is created or sent.
 */
export function parseWebhookEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.trim())) return null;
  const key = Buffer.from(raw.trim(), "base64");
  return key.length === KEY_BYTES ? key : null;
}

export function encryptWebhookSecret(
  secret: string,
  key: Buffer,
  random: (size: number) => Buffer = randomBytes,
): string {
  const iv = random(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [FORMAT_VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

/** Throws when the value was not produced with this key or was changed (GCM authentication). */
export function decryptWebhookSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== FORMAT_VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unknown webhook secret format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * `ServiceFlow-Signature` header: `t=<seconds>,v1=<hex HMAC-SHA256 of "<seconds>.<body>">`. The
 * receiver recomputes it with the secret and rejects old timestamps to stop replays.
 */
export function webhookSignature(body: string, secret: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`, "utf8").digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}
