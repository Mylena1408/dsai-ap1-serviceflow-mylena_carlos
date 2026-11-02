import { describe, expect, it, vi } from "vitest";
import { MAX_EVENT_ATTEMPTS, retryDelayMs } from "@/modules/events";
import { processEmailDeliveries } from "@/modules/notifications/application/email-delivery";
import type {
  EmailDeliveryStore,
  EmailMessage,
  EmailTransport,
  PendingEmailDelivery,
} from "@/modules/notifications/application/ports";
import type { EmailDeliveryState } from "@/modules/notifications/domain/email";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.3 (SF-094; CA-MAIL-06 and 07).

const now = new Date("2026-11-01T12:00:00.000Z");
const requestId = "3f2a9c1e-5b7d-4e2f-9a1b-0c8d7e6f5a4b";

function pending(id: string, overrides: Partial<PendingEmailDelivery> = {}): PendingEmailDelivery {
  return {
    id,
    status: "PENDING",
    attempts: 0,
    availableAt: now,
    sentAt: null,
    lastErrorCode: null,
    recipient: { email: `${id}@example.test`, isActive: true, role: "REQUESTER" },
    notification: { type: "status.COMPLETED", requestId, serviceName: "Troca de teclado" },
    ...overrides,
  };
}

function memoryStore(deliveries: PendingEmailDelivery[]) {
  const saved = new Map<string, EmailDeliveryState>();
  let queue = [...deliveries];
  const store: EmailDeliveryStore = {
    async claimPending(limit) {
      const batch = queue.slice(0, limit);
      queue = queue.slice(limit);
      return { deliveries: batch, now };
    },
    async save(id, state) {
      saved.set(id, state);
    },
  };
  return { store, saved };
}

function transport(send: (message: EmailMessage) => Promise<void> = async () => {}) {
  const sent: EmailMessage[] = [];
  const value: EmailTransport = {
    send: vi.fn(async (message: EmailMessage) => {
      await send(message);
      sent.push(message);
    }),
  };
  return { value, sent };
}

describe("sending pending emails (SF-094)", () => {
  it("sends to the current address and marks the delivery as sent (CA-MAIL-06)", async () => {
    const { store, saved } = memoryStore([pending("rita")]);
    const mail = transport();

    await expect(processEmailDeliveries(store, { transport: mail.value, baseUrl: "https://sf.example" })).resolves.toEqual({
      sent: 1,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
    expect(mail.sent).toEqual([
      expect.objectContaining({ to: "rita@example.test", subject: "[ServiceFlow] Solicitação concluída: Troca de teclado" }),
    ]);
    expect(mail.sent[0].text).toContain(`https://sf.example/requests/${requestId}`);
    expect(saved.get("rita")).toMatchObject({ status: "SENT", attempts: 1, sentAt: now, lastErrorCode: null });
  });

  it("retries a failure keeping only its code, and fails after the last attempt (CA-MAIL-06)", async () => {
    const error = Object.assign(new Error("rejected rita@example.test: provider said no"), { code: "HTTP_503" });
    const { store, saved } = memoryStore([pending("rita"), pending("ana", { attempts: MAX_EVENT_ATTEMPTS - 1 })]);
    const mail = transport(async () => {
      throw error;
    });

    await expect(processEmailDeliveries(store, { transport: mail.value, baseUrl: "https://sf.example" })).resolves.toEqual({
      sent: 0,
      retried: 1,
      failed: 1,
      skipped: 0,
    });
    expect(saved.get("rita")).toEqual({
      status: "PENDING",
      attempts: 1,
      availableAt: new Date(now.getTime() + retryDelayMs(1)),
      sentAt: null,
      lastErrorCode: "HTTP_503",
    });
    expect(saved.get("ana")).toMatchObject({ status: "FAILED", attempts: MAX_EVENT_ATTEMPTS, lastErrorCode: "HTTP_503" });
    expect(JSON.stringify([...saved.values()])).not.toContain("rita@example.test");
  });

  it("records a failure without a code by its class only", async () => {
    const { store, saved } = memoryStore([pending("rita")]);
    const mail = transport(async () => {
      throw new TypeError("fetch failed for rita@example.test");
    });

    await processEmailDeliveries(store, { transport: mail.value, baseUrl: "https://sf.example" });
    expect(saved.get("rita")?.lastErrorCode).toBe("TypeError");
  });

  it("does not send without configuration, nor to inactive people or administrators (CA-MAIL-07)", async () => {
    const unconfigured = memoryStore([pending("rita")]);
    await expect(processEmailDeliveries(unconfigured.store, null)).resolves.toEqual({ sent: 0, retried: 0, failed: 0, skipped: 1 });
    expect(unconfigured.saved.get("rita")).toMatchObject({ status: "SKIPPED", attempts: 0, lastErrorCode: "not_configured" });

    const { store, saved } = memoryStore([
      pending("bia", { recipient: { email: "bia@example.test", isActive: false, role: "ATTENDANT" } }),
      pending("root", { recipient: { email: "root@example.test", isActive: true, role: "ADMIN" } }),
    ]);
    const mail = transport();
    await processEmailDeliveries(store, { transport: mail.value, baseUrl: "https://sf.example" });

    expect(mail.value.send).not.toHaveBeenCalled();
    expect(saved.get("bia")).toMatchObject({ status: "SKIPPED", lastErrorCode: "recipient_inactive" });
    expect(saved.get("root")).toMatchObject({ status: "SKIPPED", lastErrorCode: "recipient_without_area" });
  });

  it("works through full batches up to the limit of batches", async () => {
    const { store, saved } = memoryStore(["a", "b", "c", "d", "e"].map((id) => pending(id)));

    await processEmailDeliveries(store, null, { batchSize: 2, maxBatches: 2 });
    expect([...saved.keys()]).toEqual(["a", "b", "c", "d"]);
  });
});
