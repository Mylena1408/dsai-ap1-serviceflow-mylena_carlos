-- SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 and 3.4 (decisions I1 to I4): each sector's tags, the tags on
-- requests and their history. Additive only: new enums, tables, indexes and constraints; the audit trail gains
-- the sector tag as an entity.

-- CreateEnum
CREATE TYPE "public"."RequestTagAction" AS ENUM ('ADDED', 'REMOVED');

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'SECTOR_TAG';

-- CreateTable
CREATE TABLE "public"."SectorTag" (
    "id" UUID NOT NULL,
    "sectorId" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SectorTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestTag" (
    "requestId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "addedById" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestTag_pkey" PRIMARY KEY ("requestId","tagId")
);

-- CreateTable
CREATE TABLE "public"."RequestTagEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "action" "public"."RequestTagAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestTagEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectorTag_sectorId_idx" ON "public"."SectorTag"("sectorId");

-- CreateIndex
CREATE INDEX "RequestTag_tagId_idx" ON "public"."RequestTag"("tagId");

-- CreateIndex
CREATE INDEX "RequestTagEvent_requestId_occurredAt_idx" ON "public"."RequestTagEvent"("requestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."SectorTag" ADD CONSTRAINT "SectorTag_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTag" ADD CONSTRAINT "RequestTag_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTag" ADD CONSTRAINT "RequestTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "public"."SectorTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTag" ADD CONSTRAINT "RequestTag_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTagEvent" ADD CONSTRAINT "RequestTagEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTagEvent" ADD CONSTRAINT "RequestTagEvent_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "public"."SectorTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTagEvent" ADD CONSTRAINT "RequestTagEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3.3 item 1: a name unique among the sector's active tags, ignoring case (citext).
CREATE UNIQUE INDEX "SectorTag_sectorId_name_active_key" ON "public"."SectorTag" ("sectorId", "name") WHERE "isActive" = true;

-- 3.3 item 1 (decision I3): a name of 1 to 30 characters without spaces at the ends, and a color of the fixed
-- palette. Both columns are NOT NULL, so the CHECK never sees a NULL.
ALTER TABLE "public"."SectorTag"
ADD CONSTRAINT "SectorTag_values_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 30
    AND "color" IN ('gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple')
);
