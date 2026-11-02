-- Audit trail and personal data (SPEC 2026-11-02-auditoria-lgpd, section 6). Additive only:
-- two enums, one table and two nullable columns; no existing row changes.

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('CREATED', 'UPDATED', 'REORDERED', 'DEACTIVATED', 'REACTIVATED', 'ANONYMIZED', 'EXPORTED');

-- CreateEnum
CREATE TYPE "public"."AuditEntityType" AS ENUM ('USER', 'SECTOR', 'CATEGORY', 'SERVICE', 'DOCUMENT_REQUIREMENT', 'SERVICE_FIELD', 'SERVICE_STAGE');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "anonymizedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "public"."RequestAttachment" ADD COLUMN     "removedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "public"."AuditEntry" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID NOT NULL,
    "actorRole" "public"."Role" NOT NULL,
    "action" "public"."AuditAction" NOT NULL,
    "entityType" "public"."AuditEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEntry_occurredAt_id_idx" ON "public"."AuditEntry"("occurredAt", "id");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "public"."AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEntry_actorId_occurredAt_idx" ON "public"."AuditEntry"("actorId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."AuditEntry" ADD CONSTRAINT "AuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

