import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_PROVIDER_URL,
  EmailSendError,
  createHttpEmailTransport,
  getEmailConfig,
} from "@/modules/notifications/infrastructure/http-email-transport";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.3 (SF-094; CA-MAIL-06 and 07). No network:
// fetch is replaced in every test.

const env = { EMAIL_API_KEY: "test-key-not-real", EMAIL_FROM: "ServiceFlow <avisos@exemplo.test>", APP_BASE_URL: "https://sf.example/" };
const message = { to: "rita@exemplo.test", subject: "[ServiceFlow] Prazo vencido: Troca", text: "Prazo vencido: Troca" };

describe("email configuration (SF-094)", () => {
  it("needs the three variables, valid", () => {
    expect(getEmailConfig(env)).toEqual({ apiKey: "test-key-not-real", from: "ServiceFlow <avisos@exemplo.test>", baseUrl: "https://sf.example" });
    expect(getEmailConfig({ ...env, EMAIL_FROM: "avisos@exemplo.test" })).not.toBeNull();
    expect(getEmailConfig({ ...env, APP_BASE_URL: "http://localhost:3000" })?.baseUrl).toBe("http://localhost:3000");

    expect(getEmailConfig({})).toBeNull();
    expect(getEmailConfig({ ...env, EMAIL_API_KEY: "  " })).toBeNull();
    expect(getEmailConfig({ ...env, EMAIL_FROM: "ServiceFlow" })).toBeNull();
    expect(getEmailConfig({ ...env, APP_BASE_URL: "" })).toBeNull();
    expect(getEmailConfig({ ...env, APP_BASE_URL: "não é url" })).toBeNull();
    expect(getEmailConfig({ ...env, APP_BASE_URL: "http://sf.example" })).toBeNull();
  });
});

describe("HTTP email transport (SF-094)", () => {
  it("posts one plain-text email to the provider with the key in the header", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await createHttpEmailTransport(getEmailConfig(env)!, fetchImpl as typeof fetch).send(message);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EMAIL_PROVIDER_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-key-not-real", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      from: "ServiceFlow <avisos@exemplo.test>",
      to: ["rita@exemplo.test"],
      subject: message.subject,
      text: message.text,
    });
  });

  it("reports failures by a short code, without the key, the address or the response", async () => {
    const rejected = createHttpEmailTransport(
      getEmailConfig(env)!,
      (async () => new Response('{"message":"invalid rita@exemplo.test"}', { status: 422 })) as typeof fetch,
    );
    const error = await rejected.send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error).toMatchObject({ code: "HTTP_422" });
    expect(String((error as Error).message)).not.toMatch(/rita|test-key/);

    const offline = createHttpEmailTransport(getEmailConfig(env)!, (async () => {
      throw new TypeError("getaddrinfo ENOTFOUND api.resend.com");
    }) as typeof fetch);
    await expect(offline.send(message)).rejects.toMatchObject({ code: "NETWORK" });
  });
});
