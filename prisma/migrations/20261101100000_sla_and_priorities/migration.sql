-- SPEC 2026-11-01 (SLA e prioridades), seção 6. Additive only: existing requests become NORMAL without SLA.

-- CreateEnum
CREATE TYPE "public"."RequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "completedLate" BOOLEAN,
ADD COLUMN     "dueAt" TIMESTAMPTZ,
ADD COLUMN     "priority" "public"."RequestPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "slaBreachNotifiedAt" TIMESTAMPTZ,
ADD COLUMN     "slaHoursSnapshot" INTEGER,
ADD COLUMN     "slaWarningNotifiedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "public"."Service" ADD COLUMN     "defaultPriority" "public"."RequestPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "slaHours" INTEGER;

-- CreateTable
CREATE TABLE "public"."RequestPriorityEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromPriority" "public"."RequestPriority" NOT NULL,
    "toPriority" "public"."RequestPriority" NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestPriorityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestPriorityEvent_requestId_idx" ON "public"."RequestPriorityEvent"("requestId");

-- CreateIndex
CREATE INDEX "Request_sectorId_dueAt_idx" ON "public"."Request"("sectorId", "dueAt");

-- AddForeignKey
ALTER TABLE "public"."RequestPriorityEvent" ADD CONSTRAINT "RequestPriorityEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestPriorityEvent" ADD CONSTRAINT "RequestPriorityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Base SLA of a service and its snapshot on the request: 1 to 2,000 hours (SPEC seção 5.2).
ALTER TABLE "public"."Service"
ADD CONSTRAINT "Service_slaHours_check"
CHECK ("slaHours" IS NULL OR "slaHours" BETWEEN 1 AND 2000);

ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_slaHoursSnapshot_check"
CHECK ("slaHoursSnapshot" IS NULL OR "slaHoursSnapshot" BETWEEN 1 AND 2000);

-- A request has a due date exactly when it has an SLA snapshot (seção 5.3).
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_dueAt_check"
CHECK (("dueAt" IS NULL) = ("slaHoursSnapshot" IS NULL));

-- The completion result exists only for completed requests with an SLA (seção 5.3).
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_completedLate_check"
CHECK ("completedLate" IS NULL OR ("status" = 'COMPLETED' AND "slaHoursSnapshot" IS NOT NULL));

-- Every priority event changes the priority.
ALTER TABLE "public"."RequestPriorityEvent"
ADD CONSTRAINT "RequestPriorityEvent_change_check"
CHECK ("fromPriority" <> "toPriority");

-- New event types (seção 6); the constraint is replaced to accept them.
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
  'request.sla_breached'
));
