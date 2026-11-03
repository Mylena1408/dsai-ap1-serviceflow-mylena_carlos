-- SPEC 2026-11-03 (campos condicionais, seleção múltipla e campos do atendimento), seção 6. Additive,
-- except "ServiceField_options_check", recreated only to accept 2 to 20 options also on
-- MULTI_SELECT fields: every row accepted before is still accepted.

-- CreateEnum
CREATE TYPE "public"."ServiceFieldAudience" AS ENUM ('REQUESTER', 'ATTENDANT');

-- AlterTable
ALTER TABLE "public"."ServiceField" ADD COLUMN     "audience" "public"."ServiceFieldAudience" NOT NULL DEFAULT 'REQUESTER',
ADD COLUMN     "conditionFieldId" UUID,
ADD COLUMN     "conditionValue" TEXT;

-- AlterTable
ALTER TABLE "public"."RequestFieldValue" ADD COLUMN     "updatedAt" TIMESTAMPTZ,
ADD COLUMN     "updatedById" UUID;

-- CreateTable
CREATE TABLE "public"."RequestFieldUpdateEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "labels" TEXT[],
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestFieldUpdateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestFieldUpdateEvent_requestId_idx" ON "public"."RequestFieldUpdateEvent"("requestId");

-- CreateIndex
CREATE INDEX "ServiceField_conditionFieldId_idx" ON "public"."ServiceField"("conditionFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceField_id_serviceId_key" ON "public"."ServiceField"("id", "serviceId");

-- AddForeignKey
ALTER TABLE "public"."ServiceField" ADD CONSTRAINT "ServiceField_conditionFieldId_fkey" FOREIGN KEY ("conditionFieldId") REFERENCES "public"."ServiceField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFieldValue" ADD CONSTRAINT "RequestFieldValue_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFieldUpdateEvent" ADD CONSTRAINT "RequestFieldUpdateEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFieldUpdateEvent" ADD CONSTRAINT "RequestFieldUpdateEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The controller belongs to the same service (5.2.2): composite key over (id, serviceId).
ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_condition_same_service_fkey"
FOREIGN KEY ("conditionFieldId", "serviceId") REFERENCES "public"."ServiceField"("id", "serviceId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- A condition has both columns or none, never points to the field itself, and the value is 1 to 80
-- characters (an option, or "true"/"false"). "conditionValue IS NOT NULL" is explicit: a CHECK
-- whose result is NULL passes, and char_length(NULL) is NULL.
ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_condition_check"
CHECK (
    ("conditionFieldId" IS NULL AND "conditionValue" IS NULL)
    OR (
        "conditionFieldId" IS NOT NULL
        AND "conditionValue" IS NOT NULL
        AND "conditionFieldId" <> "id"
        AND char_length("conditionValue") BETWEEN 1 AND 80
    )
);

-- Lists of options: SELECT and MULTI_SELECT have 2 to 20; other types none.
ALTER TABLE "public"."ServiceField" DROP CONSTRAINT "ServiceField_options_check";
ALTER TABLE "public"."ServiceField"
ADD CONSTRAINT "ServiceField_options_check"
CHECK (
    "options" IS NOT NULL
    AND "public"."service_field_options_valid"("options")
    AND CASE WHEN "type" IN ('SELECT', 'MULTI_SELECT') THEN cardinality("options") BETWEEN 2 AND 20
             ELSE cardinality("options") = 0 END
);

-- The author and the time of an attendance's save go together.
ALTER TABLE "public"."RequestFieldValue"
ADD CONSTRAINT "RequestFieldValue_update_check"
CHECK (("updatedAt" IS NULL) = ("updatedById" IS NULL));

-- A history line names 1 to 10 changed fields (the limit of active fields).
ALTER TABLE "public"."RequestFieldUpdateEvent"
ADD CONSTRAINT "RequestFieldUpdateEvent_labels_check"
CHECK ("labels" IS NOT NULL AND cardinality("labels") BETWEEN 1 AND 10);
