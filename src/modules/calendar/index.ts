import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as admin from "./application/calendar-admin";
import {
  createPrismaCalendarReader,
  createPrismaCalendarTransactionRunner,
} from "./infrastructure/prisma-calendar";

// Business calendar and holidays (SPEC 2026-11-03-pausa-sla-calendario, 5.1).
export {
  DEFAULT_CALENDAR,
  MAX_HOLIDAY_NAME_LENGTH,
  MINUTES_PER_DAY,
  WEEKDAY_LABELS,
  minuteOfTime,
  parseCalendarInput,
  parseHolidayInput,
  timeOfMinute,
  type CalendarInput,
  type CalendarSettings,
  type HolidaySettings,
} from "./domain/calendar-config";
export type { CalendarRecord, HolidayRecord } from "./application/ports";
export type { CalendarOverview } from "./application/calendar-admin";
/** For other modules' infrastructure: reads the calendar with their transaction client. */
export { loadBusinessCalendar } from "./infrastructure/prisma-calendar";

export function getCalendarOverview(database: PrismaClient = prisma): Promise<admin.CalendarOverview> {
  return admin.getCalendarOverview(createPrismaCalendarReader(database));
}

export function updateCalendar(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return admin.updateCalendar(input, createPrismaCalendarTransactionRunner(database));
}

export function createHoliday(input: unknown, database: PrismaClient = prisma): Promise<{ id: string }> {
  return admin.createHoliday(input, createPrismaCalendarTransactionRunner(database));
}

export function deleteHoliday(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return admin.deleteHoliday(input, createPrismaCalendarTransactionRunner(database));
}
