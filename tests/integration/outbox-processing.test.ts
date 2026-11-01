import { describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

vi.mock("@/server/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { purgeProcessedEvents, runOutbox, type ClaimedEvent, type EventConsumer } from "@/modules/events";
import { cleanOrphanAttachmentObjects } from "@/modules/requests";
import { runDailyJob } from "@/server/jobs";
import { createMemoryDocumentStorage } from "@/server/storage";

// SPEC 2026-10-31-eventos-outbox-jobs, sections 6.2 and 7 (SF-062).

async function requestWithEvents(count: number) {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  const base = Date.now() - 60_000;

  for (let index = 0; index < count; index += 1) {
    const at = new Date(base + index);
    await prisma.outboxEvent.create({
      data: {
        type: "request.opened",
        requestId: request.id,
        payload: { requesterId: requester.id, sectorId: sector.id },
        occurredAt: at,
        availableAt: at,
      },
    });
  }
  return request;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("outbox processing (SF-062)", () => {
  it("never hands the same event to two concurrent processors (CA-EVT-03)", async () => {
    await requestWithEvents(30);
    const handled: string[] = [];
    const slow: EventConsumer = {
      name: "slow",
      handle: async (event: ClaimedEvent) => {
        handled.push(event.id);
        await sleep(5);
      },
    };

    const [first, second] = await Promise.all([
      runOutbox([slow], { maxBatches: 5 }, prisma),
      runOutbox([slow], { maxBatches: 5 }, prisma),
    ]);

    expect(new Set(handled).size).toBe(handled.length);
    expect(first.processed + second.processed).toBe(30);
    await expect(prisma.outboxEvent.count({ where: { processedAt: null } })).resolves.toBe(0);
  });

  it("schedules retries with the code only and gives up after the last attempt (CA-EVT-04)", async () => {
    await requestWithEvents(1);
    const failing: EventConsumer = {
      name: "failing",
      handle: async () => {
        throw Object.assign(new Error("message with private text"), { code: "P2034" });
      },
    };

    await expect(runOutbox([failing], {}, prisma)).resolves.toEqual({ processed: 0, retried: 1, failed: 0 });
    const retried = await prisma.outboxEvent.findFirstOrThrow();
    expect(retried).toMatchObject({ attempts: 1, lastErrorCode: "P2034", processedAt: null, failedAt: null });
    expect(retried.availableAt.getTime() - Date.now()).toBeGreaterThan(50_000);
    await expect(runOutbox([failing], {}, prisma)).resolves.toEqual({ processed: 0, retried: 0, failed: 0 });

    await prisma.outboxEvent.update({ where: { id: retried.id }, data: { attempts: 9, availableAt: new Date(0) } });
    await expect(runOutbox([failing], {}, prisma)).resolves.toEqual({ processed: 0, retried: 0, failed: 1 });
    await expect(prisma.outboxEvent.findFirstOrThrow()).resolves.toMatchObject({ attempts: 10, failedAt: expect.any(Date) });
    expect(JSON.stringify(await prisma.outboxEvent.findMany())).not.toContain("private text");
  });

  it("runs the daily job: pending events, retention and skipped orphan cleanup (CA-EVT-05)", async () => {
    await requestWithEvents(3);
    const old = await prisma.outboxEvent.findFirstOrThrow();
    await prisma.outboxEvent.update({
      where: { id: old.id },
      data: { processedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const summary = await runDailyJob();

    expect(summary.events).toEqual({ status: "ok", result: { processed: 2, retried: 0, failed: 0 } });
    expect(summary.purgedEvents).toEqual({ status: "ok", result: 1 });
    expect(summary.orphanObjects).toEqual({ status: "skipped" });
    await expect(prisma.outboxEvent.count()).resolves.toBe(2);
    await expect(purgeProcessedEvents(new Date(Date.now() + 1000), prisma)).resolves.toBe(2);
  });

  it("removes old orphan objects and keeps the ones of existing requests", async () => {
    const request = await requestWithEvents(0);
    const orphanId = "44444444-4444-4444-8444-444444444444";
    const attachmentId = "55555555-5555-4555-8555-555555555555";
    const storage = createMemoryDocumentStorage(() => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    await storage.put(`requests/${orphanId}/${attachmentId}`, new Uint8Array([1]), "text/plain");
    await storage.put(`requests/${request.id}/${attachmentId}`, new Uint8Array([1]), "text/plain");

    await expect(cleanOrphanAttachmentObjects(new Date(), storage, prisma)).resolves.toEqual({ removed: 1, kept: 0 });
    expect(storage.size).toBe(1);
    await expect(storage.get(`requests/${request.id}/${attachmentId}`)).resolves.toBeTruthy();
  });
});
