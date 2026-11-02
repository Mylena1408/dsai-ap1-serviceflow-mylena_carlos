// Calendar days in a time zone, shared by the list filters (SPEC 2026-10-31-busca-filtros-
// paginacao, 5.4) and the dashboard periods (SPEC 2026-11-02-painel-relatorios, 5.2).

export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Why a YYYY-MM-DD text is not a calendar day, or null when it is one. */
export function calendarDayError(day: string): "invalid_format" | "invalid_value" | null {
  const match = DAY_PATTERN.exec(day);

  if (!match) {
    return "invalid_format";
  }

  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date
    ? null
    : "invalid_value";
}

function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function timeZoneOffsetMs(instant: number, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** Midnight of a valid calendar day (check it with `calendarDayError`) in the time zone. */
export function startOfZonedDay(day: string, timeZone: string = SAO_PAULO_TIME_ZONE): Date {
  const [year, month, date] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, date);
  // Two passes absorb a daylight-saving change between the guess and the result.
  let instant = utcMidnight - timeZoneOffsetMs(utcMidnight, timeZone);
  instant = utcMidnight - timeZoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** Calendar day (YYYY-MM-DD) of an instant in the time zone. */
export function zonedDayOf(instant: Date, timeZone: string = SAO_PAULO_TIME_ZONE): string {
  const parts = zonedParts(instant.getTime(), timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Date and minutes of an instant in the time zone, as "YYYY-MM-DD HH:MM". */
export function zonedDateTimeOf(instant: Date, timeZone: string = SAO_PAULO_TIME_ZONE): string {
  const parts = zonedParts(instant.getTime(), timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** The calendar day `amount` days after (or before, when negative) a valid day. */
export function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

/** Days from `first` to `last`, both included; 1 when they are the same day. */
export function daysBetweenInclusive(first: string, last: string): number {
  const toUtc = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((toUtc(last) - toUtc(first)) / 86_400_000) + 1;
}
