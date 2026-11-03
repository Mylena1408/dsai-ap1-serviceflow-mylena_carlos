import { CALENDAR_CLOCK, type SlaClock } from "@/shared/business-clock";
import type { SlaSchedule } from "../domain/sla";
import type { RequestTransaction } from "./ports";

// The clock of a request (SPEC 2026-11-03-pausa-sla-calendario, 5.2): the calendar is read in the
// same transaction, and only for requests in business hours.

export async function requestClock(transaction: RequestTransaction, businessHours: boolean | undefined): Promise<SlaClock> {
  return businessHours ? { kind: "business", calendar: await transaction.loadBusinessCalendar() } : CALENDAR_CLOCK;
}

/**
 * Columns to write for a schedule. "Due soon" goes only in business hours: in calendar hours the
 * database trigger computes it (SPEC de SLA, SF-068), so those writes stay as they were.
 */
export function scheduleColumns(
  schedule: SlaSchedule | null,
  businessHours: boolean | undefined,
): { dueAt: Date | null; dueSoonAt?: Date | null } {
  return businessHours
    ? { dueAt: schedule?.dueAt ?? null, dueSoonAt: schedule?.dueSoonAt ?? null }
    : { dueAt: schedule?.dueAt ?? null };
}
