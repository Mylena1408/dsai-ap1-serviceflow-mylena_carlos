import { addClockTime, CALENDAR_CLOCK, clockTimeBetween, type SlaClock } from "@/shared/business-clock";
import type { RequestPriority, RequestStatus } from "./request";

// SLA and priorities (SPEC 2026-11-01-sla-prioridades, sections 5.1 to 5.4). Calendar hours
// (decision S1); the service base SLA is scaled by the priority (decision S2).

export const REQUEST_PRIORITIES: readonly RequestPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
/** "Due soon" when this fraction of the effective SLA or less remains (section 5.4). */
export const SLA_WARNING_FRACTION = 0.2;

const PRIORITY_FACTORS: Record<RequestPriority, number> = {
  URGENT: 0.25,
  HIGH: 0.5,
  NORMAL: 1,
  LOW: 2,
};

const MINUTE_MS = 60 * 1000;

export type SlaSituation =
  | "none"
  | "on_time"
  | "due_soon"
  | "overdue"
  | "completed_on_time"
  | "completed_late"
  | "paused";

/** Effective SLA in whole minutes, rounded up (section 5.2). */
export function effectiveSlaMinutes(slaHours: number, priority: RequestPriority): number {
  return Math.ceil(slaHours * 60 * PRIORITY_FACTORS[priority]);
}

/** Due date counted from `start` (opening, or reopening); null without an SLA (section 5.3). */
export function dueAtFrom(start: Date, slaHours: number | null, priority: RequestPriority): Date | null {
  return slaHours === null ? null : new Date(start.getTime() + effectiveSlaMinutes(slaHours, priority) * MINUTE_MS);
}

/** Completion result: late when completed after the due date; null without an SLA. */
export function completedLateAt(dueAt: Date | null, completedAt: Date): boolean | null {
  return dueAt === null ? null : completedAt.getTime() > dueAt.getTime();
}

export interface SlaState {
  status: RequestStatus;
  priority: RequestPriority;
  slaHoursSnapshot: number | null;
  dueAt: Date | null;
  completedLate: boolean | null;
  /**
   * SPEC 2026-11-03-pausa-sla-calendario. Optional, so callers that never read them keep the
   * calendar-hours behavior: a running pause makes the situation "paused" (5.3), and in business
   * hours the stored start of "due soon" decides it, because it depends on the calendar (5.2).
   */
  slaPausedAt?: Date | null;
  slaBusinessHours?: boolean;
  dueSoonAt?: Date | null;
}

/**
 * Situation computed when displayed (section 5.4): exact, independent of the daily job.
 * At the due date itself the request is still "due soon"; it is overdue right after.
 */
export function slaSituation(request: SlaState, now: Date): SlaSituation {
  if (request.slaHoursSnapshot === null || request.dueAt === null || request.status === "CANCELLED") {
    return "none";
  }

  if (request.status === "COMPLETED") {
    return request.completedLate ? "completed_late" : "completed_on_time";
  }

  if (request.slaPausedAt) {
    return "paused";
  }

  const remaining = request.dueAt.getTime() - now.getTime();

  if (remaining < 0) {
    return "overdue";
  }

  if (request.slaBusinessHours && request.dueSoonAt) {
    return now.getTime() >= request.dueSoonAt.getTime() ? "due_soon" : "on_time";
  }

  const warningWindow = effectiveSlaMinutes(request.slaHoursSnapshot, request.priority) * MINUTE_MS * SLA_WARNING_FRACTION;
  return remaining <= warningWindow ? "due_soon" : "on_time";
}

export type SlaAlertKind = "warning" | "breach";

export interface SlaAlertState extends SlaState {
  slaWarningNotifiedAt: Date | null;
  slaBreachNotifiedAt: Date | null;
}

/**
 * Alert the daily job still owes this request (section 5.5): once per situation. A request
 * found already overdue gets only the breach alert; a late "due soon" would be noise.
 */
export function pendingSlaAlert(request: SlaAlertState, now: Date): SlaAlertKind | null {
  const situation = slaSituation(request, now);

  if (situation === "overdue") {
    return request.slaBreachNotifiedAt === null ? "breach" : null;
  }

  if (situation === "due_soon") {
    return request.slaWarningNotifiedAt === null ? "warning" : null;
  }

  return null;
}

export function isRequestPriority(value: unknown): value is RequestPriority {
  return typeof value === "string" && (REQUEST_PRIORITIES as readonly string[]).includes(value);
}

/**
 * New due date after a priority change (section 5.3). The counting period starts at the
 * opening, or at the reopening; it is recovered from the current due date and the old
 * priority, so both cases use the start of the current period.
 */
export function dueAtAfterPriorityChange(
  dueAt: Date | null,
  slaHours: number | null,
  fromPriority: RequestPriority,
  toPriority: RequestPriority,
): Date | null {
  if (dueAt === null || slaHours === null) {
    return null;
  }

  const periodStart = new Date(dueAt.getTime() - effectiveSlaMinutes(slaHours, fromPriority) * MINUTE_MS);
  return dueAtFrom(periodStart, slaHours, toPriority);
}

// Clock-aware schedule (SPEC 2026-11-03-pausa-sla-calendario, 5.2 and 5.4). The due date and the
// start of "due soon" always come together: in calendar hours the database trigger computes the
// same "due soon"; in business hours the application writes it.

export interface SlaSchedule {
  dueAt: Date;
  dueSoonAt: Date;
}

function warningMs(slaHours: number, priority: RequestPriority): number {
  return effectiveSlaMinutes(slaHours, priority) * MINUTE_MS * SLA_WARNING_FRACTION;
}

function scheduleEndingAt(dueAt: Date, slaHours: number, priority: RequestPriority, clock: SlaClock): SlaSchedule {
  return { dueAt, dueSoonAt: addClockTime(dueAt, -warningMs(slaHours, priority), clock) };
}

/** Schedule counted from `start` (opening, approval or reopening) on the request's clock. */
export function slaScheduleFrom(
  start: Date,
  slaHours: number | null,
  priority: RequestPriority,
  clock: SlaClock = CALENDAR_CLOCK,
): SlaSchedule | null {
  if (slaHours === null) {
    return null;
  }

  const dueAt = addClockTime(start, effectiveSlaMinutes(slaHours, priority) * MINUTE_MS, clock);
  return scheduleEndingAt(dueAt, slaHours, priority, clock);
}

/** The SLA SPEC's 5.3 (interpretation of SF-067) on the request's clock. */
export function slaScheduleAfterPriorityChange(
  dueAt: Date | null,
  slaHours: number | null,
  fromPriority: RequestPriority,
  toPriority: RequestPriority,
  clock: SlaClock = CALENDAR_CLOCK,
): SlaSchedule | null {
  if (dueAt === null || slaHours === null) {
    return null;
  }

  const periodStart = addClockTime(dueAt, -effectiveSlaMinutes(slaHours, fromPriority) * MINUTE_MS, clock);
  return slaScheduleFrom(periodStart, slaHours, toPriority, clock);
}

/**
 * Section 5.4 item 4: the clock time that was left when the pause started is left again from the
 * resume. In calendar hours the due date moves by the length of the pause.
 */
export function slaScheduleAfterResume(
  dueAt: Date,
  pausedAt: Date,
  resumedAt: Date,
  slaHours: number,
  priority: RequestPriority,
  clock: SlaClock = CALENDAR_CLOCK,
): SlaSchedule {
  const left = clockTimeBetween(pausedAt, dueAt, clock);
  return scheduleEndingAt(addClockTime(resumedAt, left, clock), slaHours, priority, clock);
}
