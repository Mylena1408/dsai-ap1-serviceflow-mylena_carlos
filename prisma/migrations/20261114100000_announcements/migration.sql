-- SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 (decisions K2, K5 and K6): announcements with a period and an
-- audience, scheduled maintenance windows, and who dismissed which announcement. Additive only: new enums, tables,
-- indexes and constraints; the audit trail gains the announcement as an entity.

-- CreateEnum
CREATE TYPE "public"."AnnouncementLevel" AS ENUM ('INFO', 'WARNING');

-- CreateEnum
CREATE TYPE "public"."AnnouncementKind" AS ENUM ('NOTICE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "public"."AnnouncementAudience" AS ENUM ('ALL', 'ROLE', 'SECTOR');

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'ANNOUNCEMENT';

-- CreateTable
CREATE TABLE "public"."Announcement" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" "public"."AnnouncementLevel" NOT NULL,
    "kind" "public"."AnnouncementKind" NOT NULL,
    "audience" "public"."AnnouncementAudience" NOT NULL,
    "audienceRole" "public"."Role",
    "audienceSectorId" UUID,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "leadHours" INTEGER,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AnnouncementDismissal" (
    "announcementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dismissedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AnnouncementDismissal_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateIndex
CREATE INDEX "Announcement_endsAt_idx" ON "public"."Announcement"("endsAt");

-- CreateIndex
CREATE INDEX "Announcement_audienceSectorId_idx" ON "public"."Announcement"("audienceSectorId");

-- CreateIndex
CREATE INDEX "AnnouncementDismissal_userId_idx" ON "public"."AnnouncementDismissal"("userId");

-- AddForeignKey
ALTER TABLE "public"."Announcement" ADD CONSTRAINT "Announcement_audienceSectorId_fkey" FOREIGN KEY ("audienceSectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "public"."Announcement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AnnouncementDismissal" ADD CONSTRAINT "AnnouncementDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3.3 item 1: a title of 1 to 80 characters and a text of 1 to 500, without spaces at the ends; the end after the
-- start. Every column here is NOT NULL, so the CHECK never sees a NULL.
ALTER TABLE "public"."Announcement"
ADD CONSTRAINT "Announcement_values_check"
CHECK (
    "title" = btrim("title")
    AND char_length("title") BETWEEN 1 AND 80
    AND "body" = btrim("body")
    AND char_length("body") BETWEEN 1 AND 500
    AND "endsAt" > "startsAt"
);

-- 3.3 item 2 (decision K6): one audience; the role only for "a role" and the sector only for "a sector". The branch
-- that needs a value says IS NOT NULL: a CHECK whose result is NULL passes.
ALTER TABLE "public"."Announcement"
ADD CONSTRAINT "Announcement_audience_check"
CHECK (
    ("audience" = 'ALL' AND "audienceRole" IS NULL AND "audienceSectorId" IS NULL)
    OR ("audience" = 'ROLE' AND "audienceRole" IS NOT NULL AND "audienceSectorId" IS NULL)
    OR ("audience" = 'SECTOR' AND "audienceSectorId" IS NOT NULL AND "audienceRole" IS NULL)
);

-- 3.3 items 1 and 4 (decisions K2 and K5): a notice lasts at most 90 days and has no lead; a maintenance window lasts
-- at most 24 hours, is always a warning (never dismissed) and has a lead of 0 to 168 hours.
ALTER TABLE "public"."Announcement"
ADD CONSTRAINT "Announcement_kind_check"
CHECK (
    ("kind" = 'NOTICE' AND "leadHours" IS NULL AND "endsAt" - "startsAt" <= interval '90 days')
    OR (
        "kind" = 'MAINTENANCE'
        AND "level" = 'WARNING'
        AND "leadHours" IS NOT NULL
        AND "leadHours" BETWEEN 0 AND 168
        AND "endsAt" - "startsAt" <= interval '24 hours'
    )
);
