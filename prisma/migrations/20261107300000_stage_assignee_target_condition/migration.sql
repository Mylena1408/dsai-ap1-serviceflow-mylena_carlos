-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 5.3 e 5.4 (SF-168). Additive: nullable
-- columns, lists that start empty and constraints that existing rows already meet.

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "stageAssigneeIdsSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stageDueAt" TIMESTAMPTZ,
ADD COLUMN     "stageOverdueNotifiedAt" TIMESTAMPTZ,
ADD COLUMN     "stageTargetDaysSnapshot" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "public"."ServiceStage" ADD COLUMN     "assigneeId" UUID,
ADD COLUMN     "conditionFieldId" UUID,
ADD COLUMN     "conditionValue" TEXT,
ADD COLUMN     "targetDays" INTEGER;

-- CreateIndex
CREATE INDEX "Request_stageDueAt_idx" ON "public"."Request"("stageDueAt");

-- AddForeignKey
ALTER TABLE "public"."ServiceStage" ADD CONSTRAINT "ServiceStage_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceStage" ADD CONSTRAINT "ServiceStage_conditionFieldId_fkey" FOREIGN KEY ("conditionFieldId") REFERENCES "public"."ServiceField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The condition uses a field of the same service (as "ServiceField_condition_same_service_fkey").
ALTER TABLE "public"."ServiceStage"
ADD CONSTRAINT "ServiceStage_condition_same_service_fkey"
FOREIGN KEY ("conditionFieldId", "serviceId") REFERENCES "public"."ServiceField"("id", "serviceId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Target from 1 to 30 days; a condition has a field and a value of 1 to 80 characters, or neither.
-- "IS NOT NULL" is explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."ServiceStage"
ADD CONSTRAINT "ServiceStage_settings_check"
CHECK (
    ("targetDays" IS NULL OR "targetDays" BETWEEN 1 AND 30)
    AND (
        ("conditionFieldId" IS NULL AND "conditionValue" IS NULL)
        OR (
            "conditionFieldId" IS NOT NULL
            AND "conditionValue" IS NOT NULL
            AND char_length("conditionValue") BETWEEN 1 AND 80
        )
    )
);

-- The lists go along the list of stage names: empty (taken before details existed, or no flow) or with
-- one item per stage; days from 0 (none) to 30. A stage due date needs a stage, and its
-- announcement needs the due date.
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_stage_details_check"
CHECK (
    "stageAssigneeIdsSnapshot" IS NOT NULL
    AND "stageTargetDaysSnapshot" IS NOT NULL
    AND (cardinality("stageAssigneeIdsSnapshot") = 0 OR cardinality("stageAssigneeIdsSnapshot") = cardinality("stageNamesSnapshot"))
    AND (cardinality("stageTargetDaysSnapshot") = 0 OR cardinality("stageTargetDaysSnapshot") = cardinality("stageNamesSnapshot"))
    AND array_position("stageAssigneeIdsSnapshot", NULL) IS NULL
    AND array_position("stageTargetDaysSnapshot", NULL) IS NULL
    AND 0 <= ALL ("stageTargetDaysSnapshot")
    AND 30 >= ALL ("stageTargetDaysSnapshot")
    AND ("stageDueAt" IS NULL OR "stageIndex" IS NOT NULL)
    AND ("stageOverdueNotifiedAt" IS NULL OR "stageDueAt" IS NOT NULL)
);
