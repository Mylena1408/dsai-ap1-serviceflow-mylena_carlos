import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as timeEntries from "./application/time-entries";
import { createPrismaTimeEntryStore } from "./infrastructure/prisma-time-entries";

// Time spent on requests (SPEC 2026-11-08-atendimento-dia-a-dia, part C): the rules (SF-206) and the entries (SF-207).
export {
  MAX_ENTRY_MINUTES,
  MAX_ENTRY_NOTE_LENGTH,
  MAX_ESTIMATED_HOURS,
  MIN_ENTRY_MINUTES,
  MIN_ESTIMATED_HOURS,
  TIME_ENTRY_WINDOW_DAYS,
  assertCanChangeEntry,
  assertCanLogTime,
  assertWorkedOnInRange,
  canChangeEntry,
  estimateLabel,
  estimatedHoursSchema,
  formatMinutes,
  timeEntryInputSchema,
  timeTotals,
} from "./domain/time-entry";
export type { TimeActor, TimeEntryInput, TimeEntryRecord, TimedRequest } from "./domain/time-entry";

/** 5.3 items 1 and 2. */
export function logTime(input: unknown, database: PrismaClient = prisma) {
  return timeEntries.logTime(input, createPrismaTimeEntryStore(database));
}

/** 5.3 item 3. */
export function updateTimeEntry(entryId: unknown, input: unknown, database: PrismaClient = prisma) {
  return timeEntries.updateTimeEntry(entryId, input, createPrismaTimeEntryStore(database));
}

export function deleteTimeEntry(entryId: unknown, database: PrismaClient = prisma) {
  return timeEntries.deleteTimeEntry(entryId, createPrismaTimeEntryStore(database));
}
