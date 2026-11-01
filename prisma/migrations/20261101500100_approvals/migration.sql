-- SPEC 2026-11-01 (aprovações), seção 6. Additive, except three constraints recreated wider, with
-- no data change: the user sector rule (managers also have a sector), the due date rule of the
-- SLA (a pending or rejected approval keeps the SLA hours without a due date) and the outbox
-- event types.

-- CreateEnum
CREATE TYPE "public"."ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "public"."Service" ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "approvalState" "public"."ApprovalState";

-- CreateTable
CREATE TABLE "public"."RequestApproval" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "deciderId" UUID NOT NULL,
    "decision" "public"."ApprovalDecision" NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestApproval_requestId_key" ON "public"."RequestApproval"("requestId");

-- CreateIndex
CREATE INDEX "RequestApproval_deciderId_idx" ON "public"."RequestApproval"("deciderId");

-- AddForeignKey
ALTER TABLE "public"."RequestApproval" ADD CONSTRAINT "RequestApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestApproval" ADD CONSTRAINT "RequestApproval_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Attendants and managers belong to exactly one sector; the other roles to none (SPEC 5.1).
ALTER TABLE "public"."User" DROP CONSTRAINT "User_role_sectorId_check";
ALTER TABLE "public"."User"
ADD CONSTRAINT "User_role_sectorId_check"
CHECK (
    ("role" IN ('ATTENDANT', 'MANAGER') AND "sectorId" IS NOT NULL)
    OR ("role" NOT IN ('ATTENDANT', 'MANAGER') AND "sectorId" IS NULL)
);

-- A due date exists exactly when there are SLA hours, except that a pending or rejected approval
-- keeps the hours without a due date: the SLA starts at the approval (SPEC 5.5). COALESCE keeps
-- the rule strict for requests without approval: "NULL IN (...)" is NULL, and a NULL CHECK passes.
ALTER TABLE "public"."Request" DROP CONSTRAINT "Request_dueAt_check";
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_dueAt_check"
CHECK (
    ("dueAt" IS NULL) = ("slaHoursSnapshot" IS NULL)
    OR (COALESCE("approvalState" IN ('PENDING', 'REJECTED'), false) AND "dueAt" IS NULL)
);

-- The approval follows the status (SPEC 5.3): pending only while open (or cancelled by the
-- requester before a decision), rejected only on a cancelled request, never with a due date
-- before the approval; a request that never required approval has no state at all.
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_approval_check"
CHECK (
    "approvalState" IS NULL
    OR "approvalState" = 'APPROVED'
    OR ("approvalState" = 'PENDING' AND "status" IN ('OPEN', 'CANCELLED') AND "dueAt" IS NULL)
    OR ("approvalState" = 'REJECTED' AND "status" = 'CANCELLED' AND "dueAt" IS NULL)
);

-- A rejection always has a note; any note is trimmed, 1 to 1,000 characters (SPEC 5.4).
ALTER TABLE "public"."RequestApproval"
ADD CONSTRAINT "RequestApproval_note_check"
CHECK (
    ("note" IS NULL OR ("note" = btrim("note") AND char_length("note") BETWEEN 1 AND 1000))
    AND ("decision" <> 'REJECTED' OR "note" IS NOT NULL)
);

ALTER TABLE "public"."OutboxEvent" DROP CONSTRAINT "OutboxEvent_type_check";
ALTER TABLE "public"."OutboxEvent"
ADD CONSTRAINT "OutboxEvent_type_check"
CHECK ("type" IN (
  'request.opened',
  'request.status_changed',
  'request.assignment_changed',
  'request.comment_added',
  'request.priority_changed',
  'request.sla_warning',
  'request.sla_breached',
  'request.stage_changed',
  'request.approval_decided'
));
