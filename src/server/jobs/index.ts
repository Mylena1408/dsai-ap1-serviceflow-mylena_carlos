import { after } from "next/server";
import { purgeProcessedEvents, runOutbox, type EventConsumer, type OutboxRunSummary } from "@/modules/events";
import { cleanOrphanAttachmentObjects, type OrphanCleanupSummary } from "@/modules/requests";
import { isDocumentStorageConfigured } from "@/server/storage";

// Composition of the event consumers and the daily job (SPEC 2026-10-31-eventos-outbox-
// jobs, sections 4 and 7). Consumers are registered here so modules never import each other.

const consumers: EventConsumer[] = [];

const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSED_EVENT_RETENTION_MS = 30 * DAY_MS;

export function eventConsumers(): readonly EventConsumer[] {
  return consumers;
}

/**
 * Processes the outbox right after the response (decision E2). Failures, or a call outside
 * a request scope (where `after` throws), leave events pending for the daily job.
 */
export function scheduleEventProcessing(): void {
  try {
    after(async () => {
      try {
        await runOutbox(consumers);
      } catch {
        // The daily job retries every pending event.
      }
    });
  } catch {
    // Outside a request scope: the daily job processes the events.
  }
}

export type DailyStep<T> = { status: "ok"; result: T } | { status: "skipped" } | { status: "error"; code: string };

export interface DailyJobSummary {
  events: DailyStep<OutboxRunSummary>;
  purgedEvents: DailyStep<number>;
  orphanObjects: DailyStep<OrphanCleanupSummary>;
}

function errorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown; reason?: unknown }) : {};
  if (typeof code.reason === "string") return code.reason;
  if (typeof code.code === "string") return code.code;
  return "UNKNOWN";
}

async function step<T>(run: () => Promise<T>): Promise<DailyStep<T>> {
  try {
    return { status: "ok", result: await run() };
  } catch (error) {
    return { status: "error", code: errorCode(error) };
  }
}

/** Skipped while no document storage is configured; a partial configuration is an error. */
async function orphanStep(now: Date): Promise<DailyStep<OrphanCleanupSummary>> {
  try {
    if (!isDocumentStorageConfigured()) {
      return { status: "skipped" };
    }
    return { status: "ok", result: await cleanOrphanAttachmentObjects(now) };
  } catch (error) {
    return { status: "error", code: errorCode(error) };
  }
}

/** Section 7: each task runs even if a previous one failed. */
export async function runDailyJob(now: Date = new Date()): Promise<DailyJobSummary> {
  const events = await step(() => runOutbox(consumers, { maxBatches: 20 }));
  const purgedEvents = await step(() => purgeProcessedEvents(new Date(now.getTime() - PROCESSED_EVENT_RETENTION_MS)));
  const orphanObjects = await orphanStep(now);

  return { events, purgedEvents, orphanObjects };
}
