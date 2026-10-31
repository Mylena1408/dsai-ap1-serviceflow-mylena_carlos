-- SPEC 2026-10-31 (atribuição, cancelamento e reabertura), seção 6. Additive only.

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "assigneeId" UUID,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "public"."RequestStatusEvent" ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "public"."RequestAssignmentEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromAssigneeId" UUID,
    "toAssigneeId" UUID,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestAssignmentEvent_requestId_idx" ON "public"."RequestAssignmentEvent"("requestId");

-- CreateIndex
CREATE INDEX "Request_sectorId_assigneeId_idx" ON "public"."Request"("sectorId", "assigneeId");

-- AddForeignKey
ALTER TABLE "public"."Request" ADD CONSTRAINT "Request_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAssignmentEvent" ADD CONSTRAINT "RequestAssignmentEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAssignmentEvent" ADD CONSTRAINT "RequestAssignmentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAssignmentEvent" ADD CONSTRAINT "RequestAssignmentEvent_fromAssigneeId_fkey" FOREIGN KEY ("fromAssigneeId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestAssignmentEvent" ADD CONSTRAINT "RequestAssignmentEvent_toAssigneeId_fkey" FOREIGN KEY ("toAssigneeId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- cancelledAt is filled exactly when the request is cancelled (SPEC seção 5.4).
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_cancelledAt_check"
CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- Cancellation and reopening reasons: 1 to 1,000 characters when present (SPEC seção 5.9).
ALTER TABLE "public"."RequestStatusEvent"
ADD CONSTRAINT "RequestStatusEvent_note_check"
CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 1000);

-- Every assignment event changes the assignee: assume (null -> user), release (user -> null)
-- or transfer (user -> other user).
ALTER TABLE "public"."RequestAssignmentEvent"
ADD CONSTRAINT "RequestAssignmentEvent_change_check"
CHECK ("fromAssigneeId" IS DISTINCT FROM "toAssigneeId");
