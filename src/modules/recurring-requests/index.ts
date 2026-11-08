import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as schedules from "./application/schedules";
import { createPrismaScheduleReader, createPrismaScheduleStore } from "./infrastructure/prisma-schedules";

// Recurring requests (SPEC 2026-11-07-operacao-e-automacao, part C). The job's runs arrive in SF-186.
export {
  FAILURES_TO_PAUSE,
  MAX_ACTIVE_SCHEDULES,
  MAX_DESCRIPTION_LENGTH,
  MAX_MONTH_DAY,
  MAX_SCHEDULE_NAME_LENGTH,
  MAX_SCHEDULE_SPAN_DAYS,
  SCHEDULE_STATUS_LABELS,
  SKIP_REASON_LABELS,
  WEEKDAY_NAMES,
  assertScheduleDates,
  dueOccurrence,
  frequencyText,
  matchesFrequency,
  nextOccurrence,
  scheduleInputSchema,
  scheduleStatus,
  type ScheduleInput,
  type ScheduleState,
  type ScheduleTiming,
  type SkipReason,
} from "./domain/schedule";
export {
  assertScheduleRoom,
  inScheduleScope,
  requesterSchedulable,
  scheduleActions,
  scheduleScopeOf,
  serviceSchedulable,
  type ScheduleAction,
  type ScheduleScope,
  type ScheduleServiceState,
} from "./domain/management";
export type { ScheduleField, ScheduleOverview, ScheduleRun, ScheduleStateChange, ScheduleView } from "./application/schedules";

export function listScheduleOverview(database: PrismaClient = prisma): Promise<schedules.ScheduleOverview> {
  return schedules.listScheduleOverview(createPrismaScheduleReader(database));
}

export function listScheduleServiceFields(serviceId: unknown, database: PrismaClient = prisma): Promise<schedules.ScheduleField[]> {
  return schedules.listScheduleServiceFields(serviceId, createPrismaScheduleReader(database));
}

export function createSchedule(input: unknown, database: PrismaClient = prisma) {
  return schedules.createSchedule(input, createPrismaScheduleStore(database));
}

export function updateSchedule(id: unknown, input: unknown, database: PrismaClient = prisma) {
  return schedules.updateSchedule(id, input, createPrismaScheduleStore(database));
}

export function changeScheduleState(id: unknown, change: schedules.ScheduleStateChange, database: PrismaClient = prisma) {
  return schedules.changeScheduleState(id, change, createPrismaScheduleStore(database));
}
