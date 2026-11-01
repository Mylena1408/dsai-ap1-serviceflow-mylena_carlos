import { describe, expect, it } from "vitest";
import { processOutbox } from "@/modules/events/application/process-outbox";
import type { ClaimedEvent, EventConsumer, OutboxStore } from "@/modules/events/application/ports";
import { failureCode, MAX_EVENT_ATTEMPTS, retryDelayMs } from "@/modules/events/domain/retry";
import { ConflictError } from "@/server/errors";

// SPEC 2026-10-31-eventos-outbox-jobs, section 6.2 (SF-062).

const MINUTE = 60_000;
const now = new Date("2026-10-31T23:00:00.000Z");

function event(id: string, attempts = 0): ClaimedEvent {
  return { id, type: "request.opened", requestId: "r", payload: {}, occurredAt: now, attempts };
}

function memoryStore(pending: ClaimedEvent[]) {
  const log: string[] = [];
  const retries: Array<{ id: string; attempts: number; availableAt: Date; code: string }> = [];
  const store: OutboxStore = {
    async claim(limit) {
      return { events: pending.splice(0, limit), now };
    },
    async markProcessed(id) {
      log.push(`processed:${id}`);
    },
    async markRetry(id, attempts, availableAt, code) {
      retries.push({ id, attempts, availableAt, code });
    },
    async markFailed(id, attempts, _at, code) {
      log.push(`failed:${id}:${attempts}:${code}`);
    },
    async purgeProcessed() {
      return 0;
    },
  };
  return { store, log, retries };
}

describe("retry rules (CA-EVT-04)", () => {
  it("waits 1, 5 and 30 minutes, then a day", () => {
    expect([1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 1440 * MINUTE, 1440 * MINUTE]);
    expect(MAX_EVENT_ATTEMPTS).toBe(10);
  });

  it("keeps codes and drops messages", () => {
    expect(failureCode(new ConflictError())).toBe("CONFLICT");
    expect(failureCode(Object.assign(new Error("secret text"), { code: "P2034" }))).toBe("P2034");
    expect(failureCode(new TypeError("secret text"))).toBe("TypeError");
    expect(failureCode(Object.assign(new Error("x"), { code: "has spaces and text" }))).toBe("Error");
    expect(failureCode("plain string")).toBe("UNKNOWN");
  });
});

describe("processOutbox", () => {
  it("sends each event to every consumer in order and marks it processed", async () => {
    const { store, log } = memoryStore([event("a"), event("b")]);
    const seen: string[] = [];
    const consumers: EventConsumer[] = [
      { name: "first", handle: async (e) => void seen.push(`first:${e.id}`) },
      { name: "second", handle: async (e) => void seen.push(`second:${e.id}`) },
    ];

    await expect(processOutbox(store, consumers)).resolves.toEqual({ processed: 2, retried: 0, failed: 0 });
    expect(seen).toEqual(["first:a", "second:a", "first:b", "second:b"]);
    expect(log).toEqual(["processed:a", "processed:b"]);
  });

  it("schedules a retry with the code only and marks the last attempt as failed", async () => {
    const { store, log, retries } = memoryStore([event("a"), event("b", MAX_EVENT_ATTEMPTS - 1)]);
    const failing: EventConsumer = {
      name: "failing",
      handle: async () => {
        throw new ConflictError();
      },
    };

    await expect(processOutbox(store, [failing])).resolves.toEqual({ processed: 0, retried: 1, failed: 1 });
    expect(retries).toEqual([{ id: "a", attempts: 1, availableAt: new Date(now.getTime() + MINUTE), code: "CONFLICT" }]);
    expect(log).toEqual([`failed:b:${MAX_EVENT_ATTEMPTS}:CONFLICT`]);
  });

  it("keeps claiming full batches up to the limit", async () => {
    const pending = Array.from({ length: 5 }, (_, index) => event(`e${index}`));
    const { store, log } = memoryStore(pending);

    await processOutbox(store, [], { batchSize: 2, maxBatches: 2 });
    expect(log).toEqual(["processed:e0", "processed:e1", "processed:e2", "processed:e3"]);

    await processOutbox(store, [], { batchSize: 2, maxBatches: 5 });
    expect(log).toHaveLength(5);
  });
});
