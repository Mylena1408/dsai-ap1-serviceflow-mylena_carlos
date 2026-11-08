import { z } from "zod";
import { ValidationError } from "@/server/errors";
import { addDays, calendarDayError, isoWeekdayOf } from "@/shared/time";
import { entityIdSchema } from "@/shared/validation";

// Schedules of recurring requests (SPEC 2026-11-07-operacao-e-automacao, 5.3, decisions H9 to H11 and H22):
// a service, a requester, the description and the answers, weekly on chosen weekdays or monthly on a day
// from 1 to 28. Days are the organization's calendar days ("YYYY-MM-DD").

export const MAX_SCHEDULE_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 10_000;
export const MAX_MONTH_DAY = 28;
/** 5.3 item 2: the end at most two years after the start. */
export const MAX_SCHEDULE_SPAN_DAYS = 731;
/** Decision H22. */
export const MAX_ACTIVE_SCHEDULES = 200;
/** 5.3 item 3: three runs in a row that did not open pause the schedule. */
export const FAILURES_TO_PAUSE = 3;

export const WEEKDAY_NAMES: Record<number, string> = {
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
  6: "sábado",
  7: "domingo",
};

const daySchema = z.string().refine((value) => calendarDayError(value) === null);

const optionalDay = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined || value === null || value.trim() === "" ? null : value.trim()))
  .refine((value) => value === null || calendarDayError(value) === null);

const answerValue = z.union([z.string().max(20_000), z.array(z.string().max(200)).max(20)]);

export const scheduleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_SCHEDULE_NAME_LENGTH),
    serviceId: entityIdSchema,
    requesterId: entityIdSchema,
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
    answers: z
      .record(z.string().max(64), answerValue)
      .refine((values) => Object.keys(values).length <= 50)
      .optional()
      .transform((values) => values ?? {}),
    frequency: z.enum(["WEEKLY", "MONTHLY"]),
    // A form sends text; blanks are dropped.
    weekdays: z
      .array(z.coerce.number().int().min(1).max(7))
      .optional()
      .transform((days) => [...new Set(days ?? [])].sort((a, b) => a - b)),
    monthDay: z.preprocess(
      (value) => (value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? null : value),
      z.coerce.number().int().min(1).max(MAX_MONTH_DAY).nullable(),
    ),
    startsOn: daySchema,
    endsOn: optionalDay,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.frequency === "WEEKLY" && input.weekdays.length === 0) context.addIssue({ code: "custom", path: ["weekdays"] });
    if (input.frequency === "MONTHLY" && input.monthDay === null) context.addIssue({ code: "custom", path: ["monthDay"] });
  })
  .transform((input) => ({
    ...input,
    // The other frequency's choice is dropped, as the database requires.
    weekdays: input.frequency === "WEEKLY" ? input.weekdays : [],
    monthDay: input.frequency === "MONTHLY" ? input.monthDay : null,
  }));

export type ScheduleInput = z.output<typeof scheduleInputSchema>;

export interface ScheduleTiming {
  frequency: "WEEKLY" | "MONTHLY";
  weekdays: readonly number[];
  monthDay: number | null;
  startsOn: string;
  endsOn: string | null;
}

/** 5.3 item 2: the start today or later; the end not before the start and within two years of it. */
export function assertScheduleDates(timing: Pick<ScheduleTiming, "startsOn" | "endsOn">, today: string): void {
  if (timing.startsOn < today) {
    throw new ValidationError([{ path: ["startsOn"], code: "too_small" }]);
  }
  if (timing.endsOn !== null && (timing.endsOn < timing.startsOn || timing.endsOn > addDays(timing.startsOn, MAX_SCHEDULE_SPAN_DAYS))) {
    throw new ValidationError([{ path: ["endsOn"], code: "invalid_value" }]);
  }
}

/** Whether a day is one of the schedule's days (ignoring the start and the end). */
export function matchesFrequency(timing: Pick<ScheduleTiming, "frequency" | "weekdays" | "monthDay">, day: string): boolean {
  if (timing.frequency === "WEEKLY") return timing.weekdays.includes(isoWeekdayOf(day));
  return Number(day.slice(8, 10)) === timing.monthDay;
}

/** The first schedule day on or after `from`, within the period, or null when there is none. */
export function nextOccurrence(timing: ScheduleTiming, from: string): string | null {
  let day = from < timing.startsOn ? timing.startsOn : from;
  // A weekly schedule repeats within 7 days and a monthly one within 31.
  for (let step = 0; step < 32; step += 1) {
    if (timing.endsOn !== null && day > timing.endsOn) return null;
    if (matchesFrequency(timing, day)) return day;
    day = addDays(day, 1);
  }
  return null;
}

/**
 * 5.3 item 3 (decision H10): the latest schedule day up to today that has not had a run; days the job
 * missed are not recovered, so only the most recent one counts.
 */
export function dueOccurrence(timing: ScheduleTiming, today: string, lastRunOn: string | null): string | null {
  let day = timing.endsOn !== null && timing.endsOn < today ? timing.endsOn : today;
  for (let step = 0; step < 32; step += 1) {
    if (day < timing.startsOn) return null;
    if (matchesFrequency(timing, day)) return lastRunOn !== null && lastRunOn >= day ? null : day;
    day = addDays(day, -1);
  }
  return null;
}

export interface ScheduleState {
  pausedAt: Date | null;
  endedAt: Date | null;
  endsOn: string | null;
}

/** "Ativa", "Pausada", "Encerrada" or "Concluída" (past its end). */
export function scheduleStatus(schedule: ScheduleState, today: string): "active" | "paused" | "ended" | "finished" {
  if (schedule.endedAt) return "ended";
  if (schedule.endsOn !== null && schedule.endsOn < today) return "finished";
  return schedule.pausedAt ? "paused" : "active";
}

export const SCHEDULE_STATUS_LABELS: Record<ReturnType<typeof scheduleStatus>, string> = {
  active: "Ativa",
  paused: "Pausada",
  ended: "Encerrada",
  finished: "Concluída",
};

/** "Semanal: segunda e quarta", "Diária" (every weekday) or "Mensal: dia 10". */
export function frequencyText(timing: Pick<ScheduleTiming, "frequency" | "weekdays" | "monthDay">): string {
  if (timing.frequency === "MONTHLY") return `Mensal: dia ${timing.monthDay}`;
  if (timing.weekdays.length === 7) return "Diária";
  const names = timing.weekdays.map((day) => WEEKDAY_NAMES[day]);
  const listed = names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
  return `Semanal: ${listed}`;
}

export type SkipReason = "SERVICE_UNAVAILABLE" | "REQUESTER_INACTIVE" | "FORM_CHANGED" | "DOCUMENT_REQUIRED";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  SERVICE_UNAVAILABLE: "o serviço não está disponível",
  REQUESTER_INACTIVE: "o solicitante não está ativo",
  FORM_CHANGED: "o formulário do serviço mudou",
  DOCUMENT_REQUIRED: "o serviço passou a pedir documentos",
};
