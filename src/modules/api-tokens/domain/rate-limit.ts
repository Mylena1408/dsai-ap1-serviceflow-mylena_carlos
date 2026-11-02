// Calls per token (SPEC 2026-11-02-api-externa-webhooks, 5.5; decision A6): a fixed window of one
// minute, counted in the database.

export const API_CALLS_PER_MINUTE = 60;
const MINUTE_MS = 60 * 1000;

/** Start of the minute that contains `now`. */
export function rateWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Decision for a call, given how many calls the window has counted including this one. A refused
 * call waits until the next window; `Retry-After` is at least one second.
 */
export function rateDecision(countIncludingThisCall: number, now: Date): RateDecision {
  if (countIncludingThisCall <= API_CALLS_PER_MINUTE) {
    return { allowed: true };
  }

  const nextWindow = rateWindowStart(now).getTime() + MINUTE_MS;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((nextWindow - now.getTime()) / 1000)) };
}

/** Windows older than one day are deleted by the daily job (5.5 and 5.7). */
export const RATE_WINDOW_RETENTION_MS = 24 * 60 * 60 * 1000;
