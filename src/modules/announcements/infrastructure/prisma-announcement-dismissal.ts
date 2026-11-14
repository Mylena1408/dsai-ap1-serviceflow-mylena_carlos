import type { PrismaClient } from "@prisma/client";
import type { AnnouncementDismissalStore } from "../application/announcement-dismissal";
import type { AnnouncementRecord } from "../domain/announcement";
import { announcementColumns } from "./prisma-announcement-admin";

// Dismissals in PostgreSQL (SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 4): one row per person and
// announcement; a repeated dismissal (two clicks, two tabs) is skipped by the primary key, not an error.

export function createPrismaAnnouncementDismissalStore(database: PrismaClient): AnnouncementDismissalStore {
  return {
    async now() {
      const [row] = await database.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row!.now;
    },
    async find(announcementId) {
      return (await database.announcement.findUnique({ where: { id: announcementId }, select: announcementColumns })) as AnnouncementRecord | null;
    },
    async dismiss(dismissal) {
      await database.announcementDismissal.createMany({ data: [dismissal], skipDuplicates: true });
    },
  };
}
