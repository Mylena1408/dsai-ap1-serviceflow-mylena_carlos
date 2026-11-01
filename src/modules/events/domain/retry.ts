// Retries of a failed event (SPEC 2026-10-31-eventos-outbox-jobs, section 6.2 item 4).

export const MAX_EVENT_ATTEMPTS = 10;
/** How long a claimed event stays reserved for the processor that claimed it. */
export const EVENT_CLAIM_LEASE_MS = 5 * 60 * 1000;

const MINUTE = 60 * 1000;
const RETRY_DELAYS_MS = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE];
const DAILY_RETRY_MS = 24 * 60 * MINUTE;

/** Wait before the next attempt, given how many attempts already failed (1, 2, 3, ...). */
export function retryDelayMs(failedAttempts: number): number {
  return RETRY_DELAYS_MS[failedAttempts - 1] ?? DAILY_RETRY_MS;
}

/**
 * A short code describing a failure, never its message: messages may carry data. Uses the
 * application or driver error code when it looks like a code, otherwise the error class.
 */
export function failureCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) {
      return code;
    }
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z0-9_]{1,64}$/.test(name)) {
      return name;
    }
  }
  return "UNKNOWN";
}
