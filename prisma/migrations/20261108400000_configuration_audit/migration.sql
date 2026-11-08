-- SPEC 2026-11-07-operacao-e-automacao, 6.4 (decision H15): the portable configuration has no tables of
-- its own; the audit trail gains the configuration as an entity and its import and export as actions.
-- Additive only: enum values, never used in this same migration.

-- AlterEnum
ALTER TYPE "public"."AuditAction" ADD VALUE 'IMPORTED';
ALTER TYPE "public"."AuditAction" ADD VALUE 'EXPORTED_CONFIGURATION';

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'CONFIGURATION';
