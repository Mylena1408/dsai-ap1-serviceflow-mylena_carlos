import { purgeProcessedEvents, runOutbox, type EventConsumer, type OutboxRunSummary } from "@/modules/events";
import { notificationConsumer, purgeReadNotifications } from "@/modules/notifications";
import { cleanOrphanAttachmentObjects, type OrphanCleanupSummary } from "@/modules/requests";
import { isDocumentStorageConfigured } from "@/server/storage";

// Composition of the event consumers and the daily job (SPEC 2026-10-31-eventos-outbox-
// jobs, sections 4 and 7). Consumers are registered here so modules never import each other.

const consumers: EventConsumer[] = [notificationConsumer()];

const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSED_EVENT_RETENTION_MS = 30 * DAY_MS;
const READ_NOTIFICATION_RETENTION_MS = 90 * DAY_MS;

export function eventConsumers(): readonly EventConsumer[] {
  return consumers;
}

/** Runs one pass of the processor (used by `scheduleEventProcessing` in ./schedule). */
export async function processEventsNow(): Promise<OutboxRunSummary> {
  return runOutbox(consumers);
}

export type DailyStep<T> = { status: "ok"; result: T } | { status: "skipped" } | { status: "error"; code: string };

export interface DailyJobSummary {
  events: DailyStep<OutboxRunSummary>;
  purgedEvents: DailyStep<number>;
  purgedNotifications: DailyStep<number>;
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
  const purgedNotifications = await step(() =>
    purgeReadNotifications(new Date(now.getTime() - READ_NOTIFICATION_RETENTION_MS)),
  );
  const orphanObjects = await orphanStep(now);

  return { events, purgedEvents, purgedNotifications, orphanObjects };
}
