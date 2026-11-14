import type { Prisma, PrismaClient } from "@prisma/client";
import type { AnnouncementStripReader } from "../application/announcement-strip";
import { MAX_LEAD_HOURS, type AnnouncementRecord, type AnnouncementViewer } from "../domain/announcement";
import { announcementColumns } from "./prisma-announcement-admin";

// The strip's reading in PostgreSQL (SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 items 2 to 4): the database
// narrows by the audience and by a window wide enough for the longest lead; the rules in the domain decide.

/** 3.3 item 2: everyone, the person's role, or the person's sector. */
export function audienceWhere(viewer: AnnouncementViewer): Prisma.AnnouncementWhereInput {
  return {
    OR: [
      { audience: "ALL" },
      { audience: "ROLE", audienceRole: viewer.role },
      ...(viewer.sectorId ? [{ audience: "SECTOR" as const, audienceSectorId: viewer.sectorId }] : []),
    ],
  };
}

export function createPrismaAnnouncementStripReader(database: PrismaClient): AnnouncementStripReader {
  return {
    async now() {
      const [row] = await database.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row!.now;
    },
    async candidates(viewer, now) {
      const latestStart = new Date(now.getTime() + MAX_LEAD_HOURS * 3_600_000);
      const rows = await database.announcement.findMany({
        where: { AND: [audienceWhere(viewer), { endsAt: { gt: now } }, { startsAt: { lte: latestStart } }] },
        select: announcementColumns,
      });
      return rows as AnnouncementRecord[];
    },
    async dismissedIds(userId, announcementIds) {
      if (announcementIds.length === 0) return [];
      const rows = await database.announcementDismissal.findMany({
        where: { userId, announcementId: { in: [...announcementIds] } },
        select: { announcementId: true },
      });
      return rows.map(({ announcementId }) => announcementId);
    },
  };
}
