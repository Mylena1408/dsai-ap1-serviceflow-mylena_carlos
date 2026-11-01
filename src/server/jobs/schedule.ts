import { after } from "next/server";

/**
 * Processes the outbox right after the response (SPEC 2026-10-31-eventos-outbox-jobs,
 * decision E2). The processor and its consumers load only when the callback runs, so
 * Server Actions stay light. Failures, or a call outside a request scope (where `after`
 * throws), leave events pending for the daily job.
 */
export function scheduleEventProcessing(): void {
  try {
    after(async () => {
      try {
        const { processEventsNow } = await import("./index");
        await processEventsNow();
      } catch {
        // The daily job retries every pending event.
      }
    });
  } catch {
    // Outside a request scope: the daily job processes the events.
  }
}
