import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// Time spent on requests (SPEC 2026-11-08-atendimento-dia-a-dia, part C and 13.2; decisions I9 to I11 and J4):
// the sector's attendants log the time they spent on a request, a day and a duration with an optional note; only
// the team sees it. Days are the organization's calendar days ("YYYY-MM-DD").

export const MIN_ENTRY_MINUTES = 1;
export const MAX_ENTRY_MINUTES = 720;
export const MAX_ENTRY_NOTE_LENGTH = 200;
/** 5.3 items 1 and 3 (decision I10): logging after the completion, and changing an entry, for up to 7 days. */
export const TIME_ENTRY_WINDOW_DAYS = 7;
export const MIN_ESTIMATED_HOURS = 1;
export const MAX_ESTIMATED_HOURS = 200;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A real calendar day written "YYYY-MM-DD". */
const daySchema = z
  .string()
  .trim()
  .regex(DAY)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

/**
 * 5.3 item 2: the day, the duration in hours and minutes (shown that way, kept in minutes, 1 to 720 in all) and a
 * note of up to 200 characters (empty is none).
 */
export const timeEntryInputSchema = z
  .object({
    workedOn: daySchema,
    hours: z.number().int().min(0).max(12),
    minutes: z.number().int().min(0).max(59),
    note: z
      .string()
      .trim()
      .max(MAX_ENTRY_NOTE_LENGTH)
      .nullable()
      .default(null)
      .transform((value) => (value === "" ? null : value)),
  })
  .strict()
  .transform(({ hours, minutes, ...rest }) => ({ ...rest, minutes: hours * 60 + minutes }))
  .refine(({ minutes }) => minutes >= MIN_ENTRY_MINUTES && minutes <= MAX_ENTRY_MINUTES, { path: ["minutes"], message: "1 to 720 minutes." });

export type TimeEntryInput = z.output<typeof timeEntryInputSchema>;

/** 13.2 item 1 (decision J4): whole hours from 1 to 200, or none. */
export const estimatedHoursSchema = z.number().int().min(MIN_ESTIMATED_HOURS).max(MAX_ESTIMATED_HOURS).nullable();

export interface TimeActor {
  id: string;
  role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
  isActive: boolean;
  sectorId: string | null;
}

export interface TimedRequest {
  sectorId: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /** The organization's day the request was opened on. */
  openedOn: string;
  completedAt: Date | null;
}

export interface TimeEntryRecord {
  id: string;
  requestId: string;
  userId: string;
  workedOn: string;
  minutes: number;
  note: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

const withinWindow = (since: Date, now: Date) => now.getTime() - since.getTime() <= TIME_ENTRY_WINDOW_DAYS * DAY_MS;

/**
 * 5.3 item 1: an attendant of the request's sector (not necessarily its assignee); never on a cancelled request;
 * after the completion, for up to 7 days. Anyone else is told the request does not exist.
 */
export function assertCanLogTime(actor: TimeActor, request: TimedRequest, now: Date): void {
  if (!actor.isActive || actor.role !== "ATTENDANT" || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }
  if (request.status === "CANCELLED") throw new ConflictError();
  if (request.status === "COMPLETED" && (!request.completedAt || !withinWindow(request.completedAt, now))) {
    throw new ConflictError();
  }
}

/** 5.3 item 2: from the request's opening day to today, both in the organization's calendar. */
export function assertWorkedOnInRange(workedOn: string, openedOn: string, today: string): void {
  if (workedOn < openedOn || workedOn > today) {
    throw new ValidationError([{ path: ["workedOn"], code: "invalid_value" }]);
  }
}

/** 5.3 item 3: only the person who logged it, up to 7 days after logging, and not removed. */
export function assertCanChangeEntry(actor: TimeActor, entry: Pick<TimeEntryRecord, "userId" | "createdAt" | "deletedAt">, now: Date): void {
  if (entry.userId !== actor.id || entry.deletedAt !== null) throw new NotFoundError();
  if (!withinWindow(entry.createdAt, now)) throw new ConflictError();
}

/** Whether an entry still changes, for the screen. */
export function canChangeEntry(actorId: string, entry: Pick<TimeEntryRecord, "userId" | "createdAt" | "deletedAt">, now: Date): boolean {
  return entry.userId === actorId && entry.deletedAt === null && withinWindow(entry.createdAt, now);
}

/** "1h 30min", "45min", "2h". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}min`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`;
}

/** 5.1 item 2: the total of the entries not removed, and by person. */
export function timeTotals<T extends Pick<TimeEntryRecord, "userId" | "minutes" | "deletedAt">>(entries: readonly T[]) {
  const live = entries.filter((entry) => entry.deletedAt === null);
  const byUser = new Map<string, number>();
  for (const entry of live) byUser.set(entry.userId, (byUser.get(entry.userId) ?? 0) + entry.minutes);
  return { total: live.reduce((sum, entry) => sum + entry.minutes, 0), byUser };
}

/** 13.2 item 1: "3h de 4h estimadas", or only the total without an estimate. */
export function estimateLabel(totalMinutes: number, estimatedHours: number | null): string {
  const total = formatMinutes(totalMinutes);
  return estimatedHours === null ? total : `${total} de ${estimatedHours}h estimadas`;
}
