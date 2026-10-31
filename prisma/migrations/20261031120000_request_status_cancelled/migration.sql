-- SPEC 2026-10-31 (atribuição, cancelamento e reabertura), seção 6.
-- A new enum value cannot be used in the transaction that adds it, so it has its own migration.
ALTER TYPE "public"."RequestStatus" ADD VALUE 'CANCELLED';
