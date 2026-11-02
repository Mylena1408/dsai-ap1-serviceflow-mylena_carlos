-- SPEC 2026-11-02-auditoria-lgpd (SF-103): the actor of an audit entry is the session's user id,
-- kept as text without a foreign key. Changes only the AuditEntry table created by SF-102, which
-- is still empty everywhere it exists (registered exception to "additive only").

-- DropForeignKey
ALTER TABLE "public"."AuditEntry" DROP CONSTRAINT "AuditEntry_actorId_fkey";

-- AlterTable
ALTER TABLE "public"."AuditEntry" ALTER COLUMN "actorId" SET DATA TYPE TEXT;

