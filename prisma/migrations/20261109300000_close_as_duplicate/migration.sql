-- SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 and 8.4 (decisions I17 and I18): closing a request as a duplicate of another.
-- Additive only: a reason on the status history (only on cancellations) and a new action on the links' history.

-- CreateEnum
CREATE TYPE "public"."RequestStatusReason" AS ENUM ('DUPLICATE');

-- AlterEnum
ALTER TYPE "public"."RequestLinkAction" ADD VALUE 'CLOSED_AS_DUPLICATE';

-- AlterTable
ALTER TABLE "public"."RequestStatusEvent" ADD COLUMN     "reason" "public"."RequestStatusReason";


-- 8.4: the reason exists only on a cancellation.
ALTER TABLE "public"."RequestStatusEvent"
ADD CONSTRAINT "RequestStatusEvent_reason_check"
CHECK ("reason" IS NULL OR "toStatus" = 'CANCELLED');
