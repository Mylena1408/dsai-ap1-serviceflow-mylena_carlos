import type { EmailTransport } from "../application/ports";

// Email provider behind the EmailTransport port (SPEC 2026-11-01-notificacoes-email-preferencias,
// 5.3, decision N3): the HTTP API of Resend, called with fetch (no new dependency). Configured
// only by server environment variables; values are never logged, shown or stored.

export const EMAIL_PROVIDER_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export const EMAIL_ENV_NAMES = ["EMAIL_API_KEY", "EMAIL_FROM", "APP_BASE_URL"] as const;

export interface EmailConfig {
  apiKey: string;
  from: string;
  /** Origin used in the links, without a trailing slash. */
  baseUrl: string;
}

/** "Nome <endereco@dominio>" or "endereco@dominio", without spaces in the address. */
const FROM_PATTERN = /^(?:[^<>]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

/**
 * Null unless all three variables are set and valid (5.3.2: without a complete configuration
 * nothing is sent). Links must use HTTPS, except on the local machine.
 */
export function getEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const apiKey = env.EMAIL_API_KEY?.trim() ?? "";
  const from = env.EMAIL_FROM?.trim() ?? "";
  const baseUrl = env.APP_BASE_URL?.trim() ?? "";

  if (!apiKey || !FROM_PATTERN.test(from) || !baseUrl) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return null;
  }

  return { apiKey, from, baseUrl: url.origin };
}

/** A failed send, described by a short code only (never the address or the provider response). */
export class EmailSendError extends Error {
  constructor(readonly code: string) {
    super(`Email not sent (${code}).`);
    this.name = "EmailSendError";
  }
}

export function createHttpEmailTransport(config: EmailConfig, fetchImpl: typeof fetch = fetch): EmailTransport {
  return {
    async send(message) {
      let response: Response;

      try {
        response = await fetchImpl(EMAIL_PROVIDER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        throw new EmailSendError("NETWORK");
      }

      if (!response.ok) {
        throw new EmailSendError(`HTTP_${response.status}`);
      }
    },
  };
}
