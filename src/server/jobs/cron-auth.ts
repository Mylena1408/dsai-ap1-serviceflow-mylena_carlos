import { timingSafeEqual } from "node:crypto";

/** Vercel recommends a random CRON_SECRET of at least 16 characters. */
export const MIN_CRON_SECRET_LENGTH = 16;

/**
 * Vercel calls cron paths with `Authorization: Bearer <CRON_SECRET>` (SPEC 2026-10-31-
 * eventos-outbox-jobs, section 7). A missing or short secret refuses every call.
 */
export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH || !authorization) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);

  return expected.length === received.length && timingSafeEqual(expected, received);
}
