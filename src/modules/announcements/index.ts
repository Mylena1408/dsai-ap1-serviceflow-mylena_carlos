import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as admin from "./application/announcement-admin";
import { createPrismaAnnouncementAdminReader, createPrismaAnnouncementAdminStore } from "./infrastructure/prisma-announcement-admin";
import * as strip from "./application/announcement-strip";
import { createPrismaAnnouncementStripReader } from "./infrastructure/prisma-announcement-strip";

// Announcements and scheduled maintenance (SPEC 2026-11-09-comunicacao-e-calendarios, part A): the rules (SF-234)
// the administration (SF-235) and the strip (SF-236). Dismissal (SF-237), maintenance (SF-238) and the page "Avisos"
// (SF-239) come next.
export {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_HISTORY_DAYS,
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_KIND_LABELS,
  ANNOUNCEMENT_LEVELS,
  ANNOUNCEMENT_LEVEL_LABELS,
  ANNOUNCEMENT_ROLES,
  AnnouncementConflict,
  DEFAULT_LEAD_HOURS,
  MAX_ANNOUNCEMENT_BODY_LENGTH,
  MAX_ANNOUNCEMENT_TITLE_LENGTH,
  MAX_LEAD_HOURS,
  MAX_MAINTENANCE_HOURS,
  MAX_NOTICE_DAYS,
  MAX_VISIBLE_ANNOUNCEMENTS,
  announcementHistory,
  announcementInputSchema,
  announcementStatus,
  assertCanBeDismissed,
  assertCanChange,
  assertCanDelete,
  assertEndsInFuture,
  assertStartedStaysStarted,
  canDismiss,
  closingEnd,
  compareAnnouncements,
  formatAnnouncementInstant,
  isShownAt,
  maintenancePhase,
  parseLocalDateTime,
  reaches,
  stripStartsAt,
  toLocalDateTimeInput,
  visibleAnnouncements,
} from "./domain/announcement";
export type {
  AnnouncementAudience,
  AnnouncementConflictReason,
  AnnouncementData,
  AnnouncementInput,
  AnnouncementKind,
  AnnouncementLevel,
  AnnouncementRecord,
  AnnouncementRole,
  AnnouncementStatus,
  AnnouncementViewer,
} from "./domain/announcement";
export type { AnnouncementAdminItem, AnnouncementAdminOverview } from "./application/announcement-admin";
export type { AnnouncementStripItem } from "./application/announcement-strip";

/** The strip of the signed-in person (3.1 item 2; SF-236). */
export function getAnnouncementStrip(database: PrismaClient = prisma): Promise<strip.AnnouncementStripItem[]> {
  return strip.getAnnouncementStrip(createPrismaAnnouncementStripReader(database));
}

/** The section "Avisos" of the administration (3.1 item 1). */
export function listAnnouncementsForAdmin(database: PrismaClient = prisma): Promise<admin.AnnouncementAdminOverview> {
  return admin.listAnnouncementsForAdmin(createPrismaAnnouncementAdminReader(database));
}

export function createAnnouncement(input: unknown, database: PrismaClient = prisma) {
  return admin.createAnnouncement(input, createPrismaAnnouncementAdminStore(database));
}

export function updateAnnouncement(announcementId: unknown, input: unknown, database: PrismaClient = prisma) {
  return admin.updateAnnouncement(announcementId, input, createPrismaAnnouncementAdminStore(database));
}

/** "Encerrar antes do fim" (3.3 item 5). */
export function closeAnnouncement(announcementId: unknown, database: PrismaClient = prisma) {
  return admin.closeAnnouncement(announcementId, createPrismaAnnouncementAdminStore(database));
}

export function deleteAnnouncement(announcementId: unknown, database: PrismaClient = prisma) {
  return admin.deleteAnnouncement(announcementId, createPrismaAnnouncementAdminStore(database));
}
