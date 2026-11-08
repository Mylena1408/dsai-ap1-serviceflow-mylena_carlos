-- SPEC 2026-11-08-atendimento-dia-a-dia, 4.3, 4.4 and 13.1 (decisions I5 to I8 and J1 to J3): each service's
-- checklist model, the checklist copied to a request when it enters the attendance, its items and their history.
-- Additive only: new enums, tables, indexes and constraints; the audit trail gains the checklist item.

-- CreateEnum
CREATE TYPE "public"."RequestChecklistAction" AS ENUM ('DONE', 'UNDONE');

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'CHECKLIST_ITEM';

-- CreateTable
CREATE TABLE "public"."ServiceChecklistItem" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "conditionFieldId" UUID,
    "conditionValue" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ServiceChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestChecklist" (
    "requestId" UUID NOT NULL,
    "copiedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestChecklist_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "public"."RequestChecklistItem" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "templateItemId" UUID,
    "textSnapshot" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,
    "doneAt" TIMESTAMPTZ,
    "doneById" UUID,
    "note" TEXT,

    CONSTRAINT "RequestChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestChecklistEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "action" "public"."RequestChecklistAction" NOT NULL,
    "note" TEXT,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestChecklistEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceChecklistItem_serviceId_idx" ON "public"."ServiceChecklistItem"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestChecklistItem_requestId_position_key" ON "public"."RequestChecklistItem"("requestId", "position");

-- CreateIndex
CREATE INDEX "RequestChecklistEvent_requestId_occurredAt_idx" ON "public"."RequestChecklistEvent"("requestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."ServiceChecklistItem" ADD CONSTRAINT "ServiceChecklistItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceChecklistItem" ADD CONSTRAINT "ServiceChecklistItem_conditionFieldId_fkey" FOREIGN KEY ("conditionFieldId") REFERENCES "public"."ServiceField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklist" ADD CONSTRAINT "RequestChecklist_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklistItem" ADD CONSTRAINT "RequestChecklistItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklistItem" ADD CONSTRAINT "RequestChecklistItem_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "public"."ServiceChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklistItem" ADD CONSTRAINT "RequestChecklistItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklistEvent" ADD CONSTRAINT "RequestChecklistEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklistEvent" ADD CONSTRAINT "RequestChecklistEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."RequestChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestChecklistEvent" ADD CONSTRAINT "RequestChecklistEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 13.1 item 1 (decision J1): the condition uses a field of the same service, as the stages' conditions
-- ("ServiceStage_condition_same_service_fkey").
ALTER TABLE "public"."ServiceChecklistItem"
ADD CONSTRAINT "ServiceChecklistItem_condition_same_service_fkey"
FOREIGN KEY ("conditionFieldId", "serviceId") REFERENCES "public"."ServiceField"("id", "serviceId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4.3 item 1: a text of 1 to 120 characters without spaces at the ends, a position from 1; a condition has a
-- field and a value of 1 to 80 characters, or neither. "IS NOT NULL" is explicit: a CHECK whose result is NULL
-- passes.
ALTER TABLE "public"."ServiceChecklistItem"
ADD CONSTRAINT "ServiceChecklistItem_values_check"
CHECK (
    "text" = btrim("text")
    AND char_length("text") BETWEEN 1 AND 120
    AND "position" >= 1
    AND (
        ("conditionFieldId" IS NULL AND "conditionValue" IS NULL)
        OR (
            "conditionFieldId" IS NOT NULL
            AND "conditionValue" IS NOT NULL
            AND char_length("conditionValue") BETWEEN 1 AND 80
        )
    )
);

-- 4.3 item 3 and 13.1 item 4: a marked item has who and when, and may have a note of 1 to 200 characters; an
-- unmarked item has none of them.
ALTER TABLE "public"."RequestChecklistItem"
ADD CONSTRAINT "RequestChecklistItem_values_check"
CHECK (
    char_length("textSnapshot") BETWEEN 1 AND 120
    AND "position" >= 1
    AND (
        ("doneAt" IS NULL AND "doneById" IS NULL AND "note" IS NULL)
        OR (
            "doneAt" IS NOT NULL
            AND "doneById" IS NOT NULL
            AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200)
        )
    )
);

-- The note of a marking, as on the item: 1 to 200 characters, or none.
ALTER TABLE "public"."RequestChecklistEvent"
ADD CONSTRAINT "RequestChecklistEvent_note_check"
CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200);
