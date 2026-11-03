import { z } from "zod";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { ConflictError, NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { BUSINESS_CALENDAR_AUDIT_ID } from "@/shared/business-clock";
import { entityIdSchema } from "@/shared/validation";
import { parseCalendarInput, parseHolidayInput } from "../domain/calendar-config";
import type { CalendarReader, CalendarRecord, CalendarTransactionRunner, HolidayRecord } from "./ports";

// "Calendário" of the administration (SPEC 2026-11-03-pausa-sla-calendario, 5.1 and 5.9): only the
// administrator configures it, and every change enters the audit trail in the same transaction.

export interface CalendarOverview {
  settings: CalendarRecord;
  holidays: HolidayRecord[];
}

const calendarSchema = z
  .object({
    weekdays: z.array(z.string()).max(7),
    startTime: z.string().max(5),
    endTime: z.string().max(5),
    timeZone: z.string().max(100),
  })
  .strict();

const holidaySchema = z
  .object({
    day: z.string().max(10),
    name: z.string().max(200),
    yearly: z.boolean(),
  })
  .strict();

const holidayIdSchema = z.object({ holidayId: entityIdSchema }).strict();

export async function getCalendarOverview(reader: CalendarReader): Promise<CalendarOverview> {
  await requireConfigurationAdministrator();
  const [settings, holidays] = await Promise.all([reader.findSettings(), reader.listHolidays()]);
  return { settings, holidays };
}

export async function updateCalendar(input: unknown, transactions: CalendarTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const settings = parseCalendarInput(validateInput(calendarSchema, input));

  await transactions.run((transaction) =>
    transaction.audited({ actor, action: "UPDATED", entityType: "BUSINESS_CALENDAR", entityId: BUSINESS_CALENDAR_AUDIT_ID }, async () => {
      await transaction.saveSettings(settings, actor.id);
      return { id: BUSINESS_CALENDAR_AUDIT_ID };
    }),
  );
}

/** Section 5.1 item 2: a second holiday on the same date is a conflict. */
export async function createHoliday(input: unknown, transactions: CalendarTransactionRunner): Promise<{ id: string }> {
  const actor = await requireConfigurationAdministrator();
  const holiday = parseHolidayInput(validateInput(holidaySchema, input));

  return transactions.run((transaction) =>
    transaction.audited({ actor, action: "CREATED", entityType: "HOLIDAY" }, async () => {
      const created = await transaction.createHoliday(holiday, actor.id);

      if (!created) {
        throw new ConflictError();
      }

      return created;
    }),
  );
}

/** The removal deletes the row; the audit keeps its date and name (5.9). */
export async function deleteHoliday(input: unknown, transactions: CalendarTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { holidayId } = validateInput(holidayIdSchema, input);

  await transactions.run(async (transaction) => {
    if (!(await transaction.holidayExists(holidayId))) {
      throw new NotFoundError();
    }

    await transaction.audited({ actor, action: "DELETED", entityType: "HOLIDAY", entityId: holidayId }, async () => {
      await transaction.deleteHoliday(holidayId);
      return { id: holidayId };
    });
  });
}
