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
        const { processEventsNow, processEmailsNow } = await import("./index");
        await processEventsNow();
        // SPEC 2026-11-01-notificacoes-email-preferencias, 5.3.3: emails go out right after too.
        await processEmailsNow();
      } catch {
        // The daily job retries every pending event and email.
      }
    });
  } catch {
    // Outside a request scope: the daily job processes the events.
  }
}
