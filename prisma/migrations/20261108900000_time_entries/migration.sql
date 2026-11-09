-- SPEC 2026-11-08-atendimento-dia-a-dia, 5.3, 5.4 and 13.2 item 1 (decisions I9 to I11 and J4): the time the
-- attendants spend on requests, its history, and each service's estimate of hours.
-- Additive only: a new enum, two tables, a nullable column, indexes and constraints.

-- CreateEnum
CREATE TYPE "public"."RequestTimeEntryAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED');

-- AlterTable
ALTER TABLE "public"."Service" ADD COLUMN     "estimatedHours" INTEGER;

-- CreateTable
CREATE TABLE "public"."RequestTimeEntry" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workedOn" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "RequestTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestTimeEntryEvent" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "action" "public"."RequestTimeEntryAction" NOT NULL,
    "workedOn" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestTimeEntryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestTimeEntry_requestId_idx" ON "public"."RequestTimeEntry"("requestId");

-- CreateIndex
CREATE INDEX "RequestTimeEntry_userId_workedOn_idx" ON "public"."RequestTimeEntry"("userId", "workedOn");

-- CreateIndex
CREATE INDEX "RequestTimeEntryEvent_requestId_occurredAt_idx" ON "public"."RequestTimeEntryEvent"("requestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."RequestTimeEntry" ADD CONSTRAINT "RequestTimeEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTimeEntry" ADD CONSTRAINT "RequestTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTimeEntryEvent" ADD CONSTRAINT "RequestTimeEntryEvent_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "public"."RequestTimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTimeEntryEvent" ADD CONSTRAINT "RequestTimeEntryEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestTimeEntryEvent" ADD CONSTRAINT "RequestTimeEntryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5.3 item 2: 1 to 720 minutes per entry and a note of 1 to 200 characters, or none.
ALTER TABLE "public"."RequestTimeEntry"
ADD CONSTRAINT "RequestTimeEntry_values_check"
CHECK (
    "minutes" BETWEEN 1 AND 720
    AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200)
);

-- The history keeps the values after each change, with the same bounds.
ALTER TABLE "public"."RequestTimeEntryEvent"
ADD CONSTRAINT "RequestTimeEntryEvent_minutes_check"
CHECK ("minutes" BETWEEN 1 AND 720);

-- An event belongs to its entry's request: the pair is unique on the entry and referenced by the event.
CREATE UNIQUE INDEX "RequestTimeEntry_id_requestId_key" ON "public"."RequestTimeEntry"("id", "requestId");

ALTER TABLE "public"."RequestTimeEntryEvent"
ADD CONSTRAINT "RequestTimeEntryEvent_same_request_fkey"
FOREIGN KEY ("entryId", "requestId") REFERENCES "public"."RequestTimeEntry"("id", "requestId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- 13.2 item 1 (decision J4): an estimate of 1 to 200 hours, or none.
ALTER TABLE "public"."Service"
ADD CONSTRAINT "Service_estimatedHours_check"
CHECK ("estimatedHours" IS NULL OR "estimatedHours" BETWEEN 1 AND 200);
