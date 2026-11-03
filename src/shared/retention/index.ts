// Retention policy (SPEC 2026-11-02-auditoria-lgpd, 5.3, decision D2): the one table of how long
// each kind of data is kept, used by the daily job and by the tests. Requests, their history,
// comments and attachments have no automatic limit; personal data leaves them by anonymization.

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionPeriod = { days: number } | { years: number };

export const RETENTION_PERIODS = {
  /** Processed events (SPEC 2026-10-31-eventos-outbox-jobs, section 7). */
  processedEvents: { days: 30 },
  /** Notifications read by the recipient (same SPEC, section 7). */
  readNotifications: { days: 90 },
  unreadNotifications: { days: 365 },
  emailDeliveries: { days: 180 },
  auditEntries: { years: 5 },
  /** SPEC 2026-11-02-api-externa-webhooks, 5.7: finished webhook deliveries. */
  webhookDeliveries: { days: 30 },
  /** Windows of the call limit (same SPEC, 5.5). */
  apiRateWindows: { days: 1 },
  /** Tokens revoked or expired (same SPEC, 5.7). */
  endedApiTokens: { days: 365 },
} as const satisfies Record<string, RetentionPeriod>;

export type RetainedData = keyof typeof RETENTION_PERIODS;

/**
 * The instant before which data of this kind is removed. Years are calendar years in UTC; from
 * February 29, five years back is March 1 (the day does not exist in that year).
 */
export function retentionCutoff(data: RetainedData, now: Date): Date {
  const period: RetentionPeriod = RETENTION_PERIODS[data];

  if ("days" in period) {
    return new Date(now.getTime() - period.days * DAY_MS);
  }

  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - period.years);
  return cutoff;
}
