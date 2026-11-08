// Recurring requests (SPEC 2026-11-07-operacao-e-automacao, part C). The use cases and the job's runs
// arrive in SF-185 and SF-186; this is the public API of the rules.
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
