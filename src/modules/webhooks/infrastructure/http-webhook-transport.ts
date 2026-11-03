import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseWebhookEncryptionKey } from "../domain/secret";
import { isBlockedAddress, type WebhookAddressOptions } from "../domain/address";
import { WEBHOOK_TIMEOUT_MS, type WebhookAttemptResult } from "../domain/delivery";
import type { WebhookRequest, WebhookTransport } from "../application/ports";

// HTTP sending of the webhooks (SPEC 2026-11-02-api-externa-webhooks, 5.6) with `fetch`, no new
// dependency. Residual risk accepted in section 9: the name may resolve differently between this
// check and the connection (DNS rebinding); only administrators register URLs.

export const WEBHOOK_ENV_NAMES = ["WEBHOOK_ENCRYPTION_KEY"] as const;

/** Key and address options from the environment; the test exception never applies in production. */
export function webhookEnvironment(env: Record<string, string | undefined> = process.env): {
  key: Buffer | null;
  address: WebhookAddressOptions;
} {
  return {
    key: parseWebhookEncryptionKey(env.WEBHOOK_ENCRYPTION_KEY),
    address: { allowLocal: env.WEBHOOK_ALLOW_LOCAL === "true" && env.NODE_ENV !== "production" },
  };
}

type Resolver = (host: string) => Promise<string[]>;

const resolveAll: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address);

export function createHttpWebhookTransport(
  options: WebhookAddressOptions,
  resolve: Resolver = resolveAll,
  send: typeof fetch = fetch,
): WebhookTransport {
  return {
    async post(url, request: WebhookRequest): Promise<WebhookAttemptResult> {
      const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
      let addresses: string[];
      try {
        addresses = isIP(host) ? [host] : await resolve(host);
      } catch {
        return { kind: "network" };
      }
      if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address, options))) {
        return { kind: "blocked" };
      }

      try {
        const response = await send(url, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "ServiceFlow-Webhooks/1",
            "ServiceFlow-Signature": request.signature,
            "ServiceFlow-Event": request.eventType,
            "ServiceFlow-Delivery": request.deliveryId,
          },
          body: request.body,
        });
        // The answer's body is never read or kept (5.6).
        await response.body?.cancel().catch(() => undefined);
        return { kind: "response", status: response.status };
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        return name === "TimeoutError" || name === "AbortError" ? { kind: "timeout" } : { kind: "network" };
      }
    },
  };
}
