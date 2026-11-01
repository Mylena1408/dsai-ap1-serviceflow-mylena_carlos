-- SPEC 2026-11-01 (aprovações), seção 6. Only the new role, in its own migration: PostgreSQL does
-- not allow using a new enum value in the same transaction that adds it.

-- AlterEnum
ALTER TYPE "public"."Role" ADD VALUE 'MANAGER';
