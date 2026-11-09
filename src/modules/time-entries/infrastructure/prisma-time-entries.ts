import type { Prisma, PrismaClient } from "@prisma/client";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { DEFAULT_CALENDAR } from "@/shared/business-clock";
import type { TimeEntryStore, TimeEntryTransaction } from "../application/time-entries";
import type { TimeEntryRecord, TimedRequest } from "../domain/time-entry";

// Time entries in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 5.4): days are DATE columns read and written
// as "YYYY-MM-DD"; the CHECKs bound the minutes and the note.

type Client = PrismaClient | Prisma.TransactionClient;

const columns = { id: true, requestId: true, userId: true, workedOn: true, minutes: true, note: true, createdAt: true, deletedAt: true } as const;

const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

export const recordOf = (row: Omit<TimeEntryRecord, "workedOn"> & { workedOn: Date }): TimeEntryRecord => ({ ...row, workedOn: dayOf(row.workedOn) });

/** The request with the organization's day it was opened on. */
export async function findTimedRequest(client: Client, requestId: string): Promise<TimedRequest | null> {
  const rows = await client.$queryRaw<Array<{ sectorId: string; status: TimedRequest["status"]; openedOn: string; completedAt: Date | null }>>`
    SELECT "sectorId", "status"::text AS "status", "completedAt",
      to_char("createdAt" AT TIME ZONE coalesce(
        (SELECT "timeZone" FROM "BusinessCalendar" WHERE "id" = 1),
        ${DEFAULT_CALENDAR.timeZone}
      ), 'YYYY-MM-DD') AS "openedOn"
    FROM "Request" WHERE "id" = ${requestId}::uuid
  `;
  return rows[0] ?? null;
}

function transactionOf(client: Prisma.TransactionClient): TimeEntryTransaction {
  return {
    findActor(userId) {
      return client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, sectorId: true } });
    },
    findRequest: (requestId) => findTimedRequest(client, requestId),
    async findEntry(entryId) {
      const row = await client.requestTimeEntry.findUnique({ where: { id: entryId }, select: columns });
      return row && recordOf(row);
    },
    today: () => organizationToday(client),
    async currentTime() {
      const [row] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
    async create({ workedOn, ...entry }) {
      return recordOf(await client.requestTimeEntry.create({ data: { ...entry, workedOn: dateOf(workedOn) }, select: columns }));
    },
    async update(entryId, { workedOn, ...data }) {
      return recordOf(
        await client.requestTimeEntry.update({
          where: { id: entryId },
          data: { ...data, ...(workedOn !== undefined ? { workedOn: dateOf(workedOn) } : {}) },
          select: columns,
        }),
      );
    },
    async insertEvent({ workedOn, ...event }) {
      await client.requestTimeEntryEvent.create({ data: { ...event, workedOn: dateOf(workedOn) } });
    },
  };
}

export function createPrismaTimeEntryStore(database: PrismaClient): TimeEntryStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2025", "P2034"],
        fallbackMessage: "Time entry change failed.",
      });
    },
  };
}
