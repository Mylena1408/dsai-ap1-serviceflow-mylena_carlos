import type { AuditScope } from "@/modules/audit";
import type { BusinessCalendar } from "@/shared/business-clock";
import type { CalendarSettings, HolidaySettings } from "../domain/calendar-config";

// Persistence of the business calendar (SPEC 2026-11-03-pausa-sla-calendario, 5.1 and 6).

export interface HolidayRecord extends HolidaySettings {
  id: string;
  createdAt: Date;
}

export interface CalendarRecord extends CalendarSettings {
  /** Null while the default applies (no row saved yet). */
  updatedAt: Date | null;
}

export interface CalendarReader {
  /** The saved calendar, or the default of 5.1 when no row exists. */
  findSettings(): Promise<CalendarRecord>;
  /** Holidays by date. */
  listHolidays(): Promise<HolidayRecord[]>;
  /** Settings and holidays as the business clock reads them. */
  loadBusinessCalendar(): Promise<BusinessCalendar>;
}

export interface CalendarTransaction extends AuditScope {
  saveSettings(settings: CalendarSettings, actorId: string): Promise<void>;
  /** Null when another holiday has the same date. */
  createHoliday(holiday: HolidaySettings, actorId: string): Promise<{ id: string } | null>;
  /** Number of rows removed. */
  deleteHoliday(holidayId: string): Promise<number>;
  holidayExists(holidayId: string): Promise<boolean>;
}

export interface CalendarTransactionRunner {
  run<T>(work: (transaction: CalendarTransaction) => Promise<T>): Promise<T>;
}
