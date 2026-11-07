import type { Prisma, PrismaClient } from "@prisma/client";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { AttendantAbsenceRecord, AttendantAbsenceStore, AttendantAbsenceTransaction } from "../application/attendant-absences";

// Attendants' absences in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 4.4). DATE columns travel as
// midnight UTC instants; the domain uses "YYYY-MM-DD".

const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

const policy = { translate: ["P2002", "P2025", "P2003", "P2034"] as const, fallbackMessage: "Attendant absence change failed." };

function transactionOf(client: Prisma.TransactionClient): AttendantAbsenceTransaction {
  return {
    today: () => organizationToday(client),
    async findPerson(userId) {
      const row = await client.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, role: true, isActive: true, sectorId: true, sector: { select: { name: true } } },
      });
      return row && { id: row.id, name: row.name, role: row.role, isActive: row.isActive, sectorId: row.sectorId, sectorName: row.sector?.name ?? null };
    },
    async absencesOf(userId) {
      const rows = await client.attendantAbsence.findMany({ where: { userId }, select: { startsOn: true, endsOn: true, cancelledAt: true } });
      return rows.map((row) => ({ startsOn: dayOf(row.startsOn), endsOn: dayOf(row.endsOn), cancelledAt: row.cancelledAt }));
    },
    async findAbsence(absenceId) {
      const row = await client.attendantAbsence.findUnique({ where: { id: absenceId }, select: { id: true, userId: true, endsOn: true, cancelledAt: true } });
      return row && { ...row, endsOn: dayOf(row.endsOn) };
    },
    create(input) {
      return client.attendantAbsence.create({
        data: { userId: input.userId, createdById: input.createdById, startsOn: dateOf(input.startsOn), endsOn: dateOf(input.endsOn) },
        select: { id: true },
      });
    },
    async cancel(absenceId) {
      const [{ now }] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      await client.attendantAbsence.update({ where: { id: absenceId }, data: { cancelledAt: now } });
    },
  };
}

export function createPrismaAttendantAbsenceStore(database: PrismaClient): AttendantAbsenceStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), policy);
    },
    today: () => organizationToday(database),
    async list({ sectorId, userId }) {
      const rows = await database.attendantAbsence.findMany({
        where: userId ? { userId } : sectorId ? { user: { sectorId } } : {},
        orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          startsOn: true,
          endsOn: true,
          createdAt: true,
          cancelledAt: true,
          redistributedAt: true,
          user: { select: { id: true, name: true, sector: { select: { name: true } } } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      return rows.map(
        (row): AttendantAbsenceRecord => ({
          id: row.id,
          startsOn: dayOf(row.startsOn),
          endsOn: dayOf(row.endsOn),
          createdAt: row.createdAt,
          cancelledAt: row.cancelledAt,
          redistributedAt: row.redistributedAt,
          attendant: { id: row.user.id, name: row.user.name, sectorName: row.user.sector?.name ?? null },
          createdBy: row.createdBy,
        }),
      );
    },
    async attendants(sectorId) {
      const rows = await database.user.findMany({
        where: { role: "ATTENDANT", isActive: true, sectorId: sectorId ?? { not: null } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, sector: { select: { name: true } } },
      });
      return rows.map((row) => ({ id: row.id, name: row.name, sectorName: row.sector?.name ?? null }));
    },
  };
}
