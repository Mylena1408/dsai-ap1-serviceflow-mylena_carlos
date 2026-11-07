import type { Prisma, PrismaClient } from "@prisma/client";
import { loadBusinessCalendar } from "@/modules/calendar";
import { zonedDayOf } from "@/shared/time";

// Absences in force (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5): today is the
// organization's calendar day, from the database clock in the business calendar's time zone, and
// both days of a period count. Only active managers count, on both sides of the absence.

type Client = PrismaClient | Prisma.TransactionClient;

export interface ApprovalCoverage {
  /** Sector of the absent manager, whose approvals the substitute decides. */
  sectorId: string;
  /** The absent manager, recorded as "on behalf of" on a decision. */
  managerId: string;
}

/** Today's calendar day of the organization, as the midnight UTC instant of a DATE column. */
export async function organizationToday(client: Client): Promise<Date> {
  const [{ value }] = await client.$queryRaw<Array<{ value: Date }>>`SELECT now() AS "value"`;
  const calendar = await loadBusinessCalendar(client);
  return new Date(`${zonedDayOf(value, calendar.timeZone)}T00:00:00.000Z`);
}

function inForce(day: Date): Prisma.ManagerAbsenceWhereInput {
  return {
    cancelledAt: null,
    startsOn: { lte: day },
    endsOn: { gte: day },
    manager: { role: "MANAGER", isActive: true, sectorId: { not: null } },
    substitute: { role: "MANAGER", isActive: true },
  };
}

/** Sectors a substitute covers today, with the absent manager of each (first by id when several). */
export async function approvalCoverage(client: Client, substituteId: string): Promise<ApprovalCoverage[]> {
  const rows = await client.managerAbsence.findMany({
    where: { substituteId, ...inForce(await organizationToday(client)) },
    select: { managerId: true, manager: { select: { sectorId: true } } },
    orderBy: [{ managerId: "asc" }],
  });
  const coverage = new Map<string, string>();
  for (const row of rows) {
    if (row.manager.sectorId && !coverage.has(row.manager.sectorId)) coverage.set(row.manager.sectorId, row.managerId);
  }
  return [...coverage].map(([sectorId, managerId]) => ({ sectorId, managerId }));
}

/** Substitutes in force today for the absent managers of a sector. */
export async function sectorSubstituteIds(client: Client, sectorId: string): Promise<string[]> {
  const rows = await client.managerAbsence.findMany({
    where: { ...inForce(await organizationToday(client)), manager: { role: "MANAGER", isActive: true, sectorId } },
    select: { substituteId: true },
    orderBy: [{ substituteId: "asc" }],
  });
  return [...new Set(rows.map(({ substituteId }) => substituteId))];
}
