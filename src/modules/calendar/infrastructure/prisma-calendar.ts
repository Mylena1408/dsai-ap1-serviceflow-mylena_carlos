import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { DEFAULT_CALENDAR, type BusinessCalendar } from "@/shared/business-clock";
import type { CalendarReader, CalendarRecord, CalendarTransaction, CalendarTransactionRunner, HolidayRecord } from "../application/ports";

// Business calendar in PostgreSQL (SPEC 2026-11-03-pausa-sla-calendario, 6). A single row with
// id 1; without it, the default of 5.1 applies. Holidays are stored as dates (no time zone).

type Client = PrismaClient | Prisma.TransactionClient;

const dayText = (day: Date) => day.toISOString().slice(0, 10);
const dayValue = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function findSettings(client: Client): Promise<CalendarRecord> {
  const row = await client.businessCalendar.findUnique({ where: { id: 1 } });

  if (!row) {
    return { ...DEFAULT_CALENDAR, weekdays: [...DEFAULT_CALENDAR.weekdays], updatedAt: null };
  }

  return {
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    timeZone: row.timeZone,
    updatedAt: row.updatedAt,
  };
}

async function listHolidays(client: Client): Promise<HolidayRecord[]> {
  const rows = await client.businessHoliday.findMany({ orderBy: { day: "asc" } });
  return rows.map((row) => ({ id: row.id, day: dayText(row.day), name: row.name, yearly: row.yearly, createdAt: row.createdAt }));
}

/** What the business clock needs, read with any client (also inside a request transaction). */
export async function loadBusinessCalendar(client: Client): Promise<BusinessCalendar> {
  const [settings, holidays] = await Promise.all([
    findSettings(client),
    client.businessHoliday.findMany({ select: { day: true, yearly: true } }),
  ]);

  return {
    weekdays: settings.weekdays,
    startMinute: settings.startMinute,
    endMinute: settings.endMinute,
    timeZone: settings.timeZone,
    holidays: holidays.map((holiday) => ({ day: dayText(holiday.day), yearly: holiday.yearly })),
  };
}

export function createPrismaCalendarReader(database: PrismaClient): CalendarReader {
  return {
    findSettings: () => findSettings(database),
    listHolidays: () => listHolidays(database),
    loadBusinessCalendar: () => loadBusinessCalendar(database),
  };
}

function createPrismaCalendarTransaction(transaction: Prisma.TransactionClient): CalendarTransaction {
  return {
    ...createPrismaAuditScope(transaction),
    async saveSettings(settings, actorId) {
      const data = { ...settings, updatedAt: new Date(), updatedById: actorId };
      await transaction.businessCalendar.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    },
    async createHoliday(holiday, actorId) {
      const day = dayValue(holiday.day);

      if (await transaction.businessHoliday.findUnique({ where: { day }, select: { id: true } })) {
        return null;
      }

      return transaction.businessHoliday.create({
        data: { day, name: holiday.name, yearly: holiday.yearly, createdById: actorId },
        select: { id: true },
      });
    },
    async deleteHoliday(holidayId) {
      const { count } = await transaction.businessHoliday.deleteMany({ where: { id: holidayId } });
      return count;
    },
    async holidayExists(holidayId) {
      return (await transaction.businessHoliday.count({ where: { id: holidayId } })) > 0;
    },
  };
}

export function createPrismaCalendarTransactionRunner(database: PrismaClient): CalendarTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(createPrismaCalendarTransaction(transaction)), {
        // Two holidays on the same date at once: the unique index refuses the second (5.1).
        translate: ["P2002"],
        fallbackMessage: "Calendar operation failed.",
      });
    },
  };
}
