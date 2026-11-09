// Time spent on requests (SPEC 2026-11-08-atendimento-dia-a-dia, part C): the rules (SF-206).
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
