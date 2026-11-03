-- SPEC 2026-11-03 (pausa do prazo e calendário de horas úteis), seção 6. Additive, except three
-- objects recreated wider, without data loss: the "dueSoonAt" trigger function (it now keeps the
-- value written by the application in business hours) and the type CHECKs of the outbox and of
-- the webhooks (they accept "request.sla_paused" and "request.sla_resumed"; every value accepted
-- before is still accepted).

-- CreateEnum
CREATE TYPE "public"."SlaResumeCause" AS ENUM ('MANUAL', 'REQUESTER_REPLY', 'ATTENDANCE_ENDED');

-- AlterEnum (the new values are not used in this migration)
ALTER TYPE "public"."AuditAction" ADD VALUE 'DELETED';
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'BUSINESS_CALENDAR';
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'HOLIDAY';

-- AlterTable
ALTER TABLE "public"."Service" ADD COLUMN     "slaBusinessHours" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "slaBusinessHours" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slaPausedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "public"."RequestSlaPause" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "pausedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "pausedAt" TIMESTAMPTZ NOT NULL,
    "resumedAt" TIMESTAMPTZ,
    "resumedById" UUID,
    "resumeCause" "public"."SlaResumeCause",

    CONSTRAINT "RequestSlaPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessCalendar" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID,

    CONSTRAINT "BusinessCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessHoliday" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "yearly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,

    CONSTRAINT "BusinessHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestSlaPause_requestId_idx" ON "public"."RequestSlaPause"("requestId");

-- At most one open pause per request (5.3).
CREATE UNIQUE INDEX "RequestSlaPause_open_key" ON "public"."RequestSlaPause"("requestId") WHERE "resumedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHoliday_day_key" ON "public"."BusinessHoliday"("day");

-- AddForeignKey
ALTER TABLE "public"."RequestSlaPause" ADD CONSTRAINT "RequestSlaPause_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSlaPause" ADD CONSTRAINT "RequestSlaPause_pausedById_fkey" FOREIGN KEY ("pausedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSlaPause" ADD CONSTRAINT "RequestSlaPause_resumedById_fkey" FOREIGN KEY ("resumedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessCalendar" ADD CONSTRAINT "BusinessCalendar_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessHoliday" ADD CONSTRAINT "BusinessHoliday_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A paused SLA only on a request in progress with a running deadline (5.3).
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_slaPausedAt_check"
CHECK (
    "slaPausedAt" IS NULL
    OR ("status" = 'IN_PROGRESS' AND "slaHoursSnapshot" IS NOT NULL AND "dueAt" IS NOT NULL)
);

-- Reason of 1 to 500 characters without surrounding spaces; the resume columns go together and
-- the resume never comes before the pause.
ALTER TABLE "public"."RequestSlaPause"
ADD CONSTRAINT "RequestSlaPause_check"
CHECK (
    "reason" = btrim("reason")
    AND char_length("reason") BETWEEN 1 AND 500
    AND (
        ("resumedAt" IS NULL AND "resumedById" IS NULL AND "resumeCause" IS NULL)
        OR ("resumedAt" IS NOT NULL AND "resumedById" IS NOT NULL AND "resumeCause" IS NOT NULL AND "resumedAt" >= "pausedAt")
    )
);

-- A single row (5.1): ISO weekdays, 1 to 7 distinct values between 1 and 7; a window inside the day.
ALTER TABLE "public"."BusinessCalendar"
ADD CONSTRAINT "BusinessCalendar_check"
CHECK (
    "id" = 1
    AND "weekdays" IS NOT NULL
    AND cardinality("weekdays") BETWEEN 1 AND 7
    AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
    AND "startMinute" >= 0
    AND "startMinute" < "endMinute"
    AND "endMinute" <= 1440
    AND char_length("timeZone") >= 1
);

-- Holiday name of 1 to 80 characters without surrounding spaces.
ALTER TABLE "public"."BusinessHoliday"
ADD CONSTRAINT "BusinessHoliday_name_check"
CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 80);

-- No row is inserted (migrations never seed data): without a row, the default calendar of 5.1
-- applies, and the first save creates the row.

-- "dueSoonAt" (SF-068): still computed here in calendar hours. In business hours the value depends
-- on the calendar, so the application writes it and the trigger keeps it (seção 6).
CREATE OR REPLACE FUNCTION "public"."request_due_soon_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."dueAt" IS NULL OR NEW."slaHoursSnapshot" IS NULL THEN
    NEW."dueSoonAt" := NULL;
  ELSIF NOT NEW."slaBusinessHours" THEN
    NEW."dueSoonAt" := NEW."dueAt" - NEW."slaHoursSnapshot" * (CASE NEW."priority"
      WHEN 'URGENT' THEN 3
      WHEN 'HIGH' THEN 6
      WHEN 'NORMAL' THEN 12
      WHEN 'LOW' THEN 24
    END) * INTERVAL '1 minute';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "Request_dueSoonAt_sync" ON "public"."Request";
CREATE TRIGGER "Request_dueSoonAt_sync"
BEFORE INSERT OR UPDATE OF "dueAt", "priority", "slaHoursSnapshot", "dueSoonAt", "slaBusinessHours"
ON "public"."Request"
FOR EACH ROW EXECUTE FUNCTION "public"."request_due_soon_at"();

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
  'request.approval_decided',
  'request.sector_changed',
  'request.document_added',
  'request.sla_paused',
  'request.sla_resumed'
));

ALTER TABLE "public"."WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_eventTypes_check";
ALTER TABLE "public"."WebhookEndpoint"
ADD CONSTRAINT "WebhookEndpoint_eventTypes_check"
CHECK (
    "eventTypes" IS NOT NULL
    AND cardinality("eventTypes") >= 1
    AND "eventTypes" <@ ARRAY[
      'request.opened',
      'request.status_changed',
      'request.assignment_changed',
      'request.comment_added',
      'request.priority_changed',
      'request.sla_warning',
      'request.sla_breached',
      'request.stage_changed',
      'request.approval_decided',
      'request.sector_changed',
      'request.document_added',
      'request.sla_paused',
      'request.sla_resumed'
    ]::TEXT[]
);
