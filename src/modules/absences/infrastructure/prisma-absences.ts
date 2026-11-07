import type { Prisma, PrismaClient } from "@prisma/client";
import { loadBusinessCalendar } from "@/modules/calendar";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { zonedDayOf } from "@/shared/time";
import type { AbsenceStore, AbsenceTransaction } from "../application/absences";
import type { AbsenceRecord } from "../domain/absence";

// Persistence of the managers' absences (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.4).
// DATE columns travel as midnight UTC instants; the domain uses "YYYY-MM-DD".

type Client = PrismaClient | Prisma.TransactionClient;

const policy = { translate: ["P2002", "P2025", "P2003", "P2034"] as const, fallbackMessage: "Absence change failed." };

const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function today(client: Client): Promise<string> {
  const [{ value }] = await client.$queryRaw<Array<{ value: Date }>>`SELECT now() AS "value"`;
  return zonedDayOf(value, (await loadBusinessCalendar(client)).timeZone);
}

const person = { select: { id: true, name: true, sector: { select: { name: true } } } } as const;

function transactionOf(client: Prisma.TransactionClient): AbsenceTransaction {
  return {
    today: () => today(client),
    findUser(userId) {
      return client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
    },
    async activePeriods(userId, as) {
      const rows = await client.managerAbsence.findMany({
        where: { ...(as === "manager" ? { managerId: userId } : { substituteId: userId }), cancelledAt: null },
        select: { startsOn: true, endsOn: true },
      });
      return rows.map((row) => ({ startsOn: dayOf(row.startsOn), endsOn: dayOf(row.endsOn) }));
    },
    async findAbsence(absenceId) {
      const row = await client.managerAbsence.findUnique({
        where: { id: absenceId },
        select: { id: true, managerId: true, endsOn: true, cancelledAt: true },
      });
      return row && { ...row, endsOn: dayOf(row.endsOn) };
    },
    async create(input) {
      return client.managerAbsence.create({
        data: { ...input, startsOn: dateOf(input.startsOn), endsOn: dateOf(input.endsOn) },
        select: { id: true },
      });
    },
    async cancel(absenceId) {
      const [{ value }] = await client.$queryRaw<Array<{ value: Date }>>`SELECT now() AS "value"`;
      await client.managerAbsence.update({ where: { id: absenceId }, data: { cancelledAt: value } });
    },
  };
}

export function createPrismaAbsenceStore(database: PrismaClient): AbsenceStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), policy);
    },
    async list(userId) {
      const rows = await database.managerAbsence.findMany({
        where: userId === null ? {} : { OR: [{ managerId: userId }, { substituteId: userId }] },
        orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
        select: { id: true, startsOn: true, endsOn: true, createdAt: true, cancelledAt: true, manager: person, substitute: person },
      });
      return rows.map(
        (row): AbsenceRecord => ({
          id: row.id,
          startsOn: dayOf(row.startsOn),
          endsOn: dayOf(row.endsOn),
          createdAt: row.createdAt,
          cancelledAt: row.cancelledAt,
          manager: { id: row.manager.id, name: row.manager.name, sectorName: row.manager.sector?.name ?? null },
          substitute: { id: row.substitute.id, name: row.substitute.name, sectorName: row.substitute.sector?.name ?? null },
        }),
      );
    },
    async listSubstituteCandidates(exceptUserId) {
      const rows = await database.user.findMany({
        where: { role: "MANAGER", isActive: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, sector: { select: { name: true } } },
      });
      return rows.map((row) => ({ id: row.id, name: row.name, sectorName: row.sector?.name ?? null }));
    },
    today: () => today(database),
  };
}
