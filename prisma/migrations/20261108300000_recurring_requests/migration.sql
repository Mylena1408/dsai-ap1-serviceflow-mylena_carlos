-- SPEC 2026-11-07-operacao-e-automacao, seções 5.3 e 5.4 (SF-184). Additive: three enums, two tables, one
-- nullable column on the requests (existing ones were opened by people), one more audit entity type and
-- the rules below.

-- CreateEnum
CREATE TYPE "public"."RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "public"."RecurringRunOutcome" AS ENUM ('OPENED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."RecurringSkipReason" AS ENUM ('SERVICE_UNAVAILABLE', 'REQUESTER_INACTIVE', 'FORM_CHANGED', 'DOCUMENT_REQUIRED');

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'RECURRING_REQUEST';

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "recurringRequestId" UUID;

-- CreateTable
CREATE TABLE "public"."RecurringRequest" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "serviceId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "frequency" "public"."RecurrenceFrequency" NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "monthDay" INTEGER,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "pausedAt" TIMESTAMPTZ,
    "endedAt" TIMESTAMPTZ,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RecurringRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RecurringRequestRun" (
    "id" UUID NOT NULL,
    "recurringRequestId" UUID NOT NULL,
    "scheduledOn" DATE NOT NULL,
    "outcome" "public"."RecurringRunOutcome" NOT NULL,
    "reason" "public"."RecurringSkipReason",
    "requestId" UUID,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RecurringRequestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringRequest_serviceId_idx" ON "public"."RecurringRequest"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringRequestRun_recurringRequestId_scheduledOn_key" ON "public"."RecurringRequestRun"("recurringRequestId", "scheduledOn");

-- AddForeignKey
ALTER TABLE "public"."Request" ADD CONSTRAINT "Request_recurringRequestId_fkey" FOREIGN KEY ("recurringRequestId") REFERENCES "public"."RecurringRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecurringRequest" ADD CONSTRAINT "RecurringRequest_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecurringRequest" ADD CONSTRAINT "RecurringRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecurringRequest" ADD CONSTRAINT "RecurringRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecurringRequestRun" ADD CONSTRAINT "RecurringRequestRun_recurringRequestId_fkey" FOREIGN KEY ("recurringRequestId") REFERENCES "public"."RecurringRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RecurringRequestRun" ADD CONSTRAINT "RecurringRequestRun_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The requests opened by a schedule.
CREATE INDEX "Request_recurringRequestId_idx" ON "public"."Request" ("recurringRequestId") WHERE "recurringRequestId" IS NOT NULL;

-- The weekdays of a weekly schedule: 1 to 7 of them, each from 1 to 7, none null or repeated.
CREATE FUNCTION "public"."recurring_weekdays_valid"(days INTEGER[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(days) BETWEEN 1 AND 7
     AND array_position(days, NULL) IS NULL
     AND (SELECT bool_and(day BETWEEN 1 AND 7) FROM unnest(days) AS day)
     AND (SELECT count(DISTINCT day) FROM unnest(days) AS day) = cardinality(days)
$$;

-- 5.3 item 2: name 1 to 80 characters without surrounding spaces; description 1 to 10,000; weekly with its
-- weekdays and no month day, monthly with a day from 1 to 28 and no weekdays; the end not before the
-- start and at most two years after it; failures never negative.
-- "IS NOT NULL" is explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."RecurringRequest"
ADD CONSTRAINT "RecurringRequest_values_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 80
    AND char_length(btrim("description")) BETWEEN 1 AND 10000
    AND "weekdays" IS NOT NULL
    AND (
        ("frequency" = 'WEEKLY' AND "monthDay" IS NULL AND "public"."recurring_weekdays_valid"("weekdays"))
        OR ("frequency" = 'MONTHLY' AND "monthDay" IS NOT NULL AND "monthDay" BETWEEN 1 AND 28 AND cardinality("weekdays") = 0)
    )
    AND ("endsOn" IS NULL OR ("endsOn" >= "startsOn" AND "endsOn" <= "startsOn" + 731))
    AND "consecutiveFailures" >= 0
    AND jsonb_typeof("answers") = 'object'
);

-- 5.3 item 3: an opened run has its request and no reason; a skipped one has the reason and no request.
ALTER TABLE "public"."RecurringRequestRun"
ADD CONSTRAINT "RecurringRequestRun_outcome_check"
CHECK (
    ("outcome" = 'OPENED' AND "requestId" IS NOT NULL AND "reason" IS NULL)
    OR ("outcome" = 'SKIPPED' AND "requestId" IS NULL AND "reason" IS NOT NULL)
);
