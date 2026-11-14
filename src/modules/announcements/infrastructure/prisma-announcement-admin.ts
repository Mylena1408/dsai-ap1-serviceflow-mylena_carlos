import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { AnnouncementAdminReader, AnnouncementAdminStore, AnnouncementAdminTransaction } from "../application/announcement-admin";
import type { AnnouncementRecord } from "../domain/announcement";

// The announcements in PostgreSQL (SPEC 2026-11-09-comunicacao-e-calendarios, 3.3): the CHECKs of the migration
// hold the rules 1 and 2 again; a deletion of an announcement with dismissals is refused by the foreign key.

export const announcementColumns = {
  id: true,
  title: true,
  body: true,
  kind: true,
  level: true,
  audience: true,
  audienceRole: true,
  audienceSectorId: true,
  startsAt: true,
  endsAt: true,
  leadHours: true,
  createdAt: true,
} as const satisfies Prisma.AnnouncementSelect;

async function databaseNow(client: Prisma.TransactionClient | PrismaClient): Promise<Date> {
  const [row] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
  return row!.now;
}

export function createPrismaAnnouncementAdminReader(database: PrismaClient): AnnouncementAdminReader {
  return {
    now: () => databaseNow(database),
    async list(endedSince) {
      const rows = await database.announcement.findMany({
        where: { endsAt: { gt: endedSince } },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        select: { ...announcementColumns, audienceSector: { select: { name: true } }, createdBy: { select: { name: true } } },
      });
      return rows.map(({ audienceSector, createdBy, ...row }) => ({
        ...(row as AnnouncementRecord),
        audienceSectorName: audienceSector?.name ?? null,
        createdByName: createdBy.name,
      }));
    },
    activeSectors() {
      return database.sector.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } });
    },
  };
}

function transactionOf(client: Prisma.TransactionClient): AnnouncementAdminTransaction {
  return {
    ...createPrismaAuditScope(client),
    now: () => databaseNow(client),
    async find(announcementId) {
      return (await client.announcement.findUnique({ where: { id: announcementId }, select: announcementColumns })) as AnnouncementRecord | null;
    },
    findSector(sectorId) {
      return client.sector.findUnique({ where: { id: sectorId }, select: { id: true, isActive: true } });
    },
    async create(data) {
      return (await client.announcement.create({ data, select: announcementColumns })) as AnnouncementRecord;
    },
    async update(announcementId, data) {
      return (await client.announcement.update({ where: { id: announcementId }, data, select: announcementColumns })) as AnnouncementRecord;
    },
    delete(announcementId) {
      return client.announcement.delete({ where: { id: announcementId }, select: { id: true } });
    },
  };
}

export function createPrismaAnnouncementAdminStore(database: PrismaClient): AnnouncementAdminStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2003", "P2025", "P2034"],
        fallbackMessage: "Announcement change failed.",
      });
    },
  };
}
