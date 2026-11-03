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
