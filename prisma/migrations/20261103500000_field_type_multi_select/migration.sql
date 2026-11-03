-- SPEC 2026-11-03 (campos condicionais, seleção múltipla e campos do atendimento), seção 6. Additive.
-- Only the new enum value: PostgreSQL does not allow using a value added in the same transaction,
-- so the constraint that mentions it comes in the next migration (as 20261101500000_manager_role).

-- AlterEnum
ALTER TYPE "public"."ServiceFieldType" ADD VALUE 'MULTI_SELECT';
