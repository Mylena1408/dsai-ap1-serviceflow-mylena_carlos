-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 4.3 e 4.4 (SF-164). Additive, except
-- the unique index of RequestApproval, which goes from one decision per request to one per level:
-- existing decisions become level 1 (the column default) and stay unique. Nothing is rewritten:
-- requests opened before levels keep an empty list, meaning one level decided by the request's
-- sector, exactly as before.

-- AlterTable
ALTER TABLE "public"."Service" ADD COLUMN     "approvalConditionFieldId" UUID,
ADD COLUMN     "approvalConditionValue" TEXT,
ADD COLUMN     "approvalSectorIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "approvalLevel" INTEGER,
ADD COLUMN     "approvalPendingSectorId" UUID,
ADD COLUMN     "approvalSectorIdsSnapshot" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "public"."RequestApproval" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex (before dropping the old one, so uniqueness never lapses)
CREATE UNIQUE INDEX "RequestApproval_requestId_level_key" ON "public"."RequestApproval"("requestId", "level");

-- DropIndex
DROP INDEX "public"."RequestApproval_requestId_key";

-- CreateIndex
CREATE INDEX "Request_approvalPendingSectorId_idx" ON "public"."Request"("approvalPendingSectorId");

-- AddForeignKey
ALTER TABLE "public"."Service" ADD CONSTRAINT "Service_approvalConditionFieldId_fkey" FOREIGN KEY ("approvalConditionFieldId") REFERENCES "public"."ServiceField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Request" ADD CONSTRAINT "Request_approvalPendingSectorId_fkey" FOREIGN KEY ("approvalPendingSectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The approval condition uses a field of the same service (as the conditional fields'
-- "ServiceField_condition_same_service_fkey").
ALTER TABLE "public"."Service"
ADD CONSTRAINT "Service_approvalCondition_same_service_fkey"
FOREIGN KEY ("approvalConditionFieldId", "id") REFERENCES "public"."ServiceField"("id", "serviceId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Levels: Prisma creates scalar lists as nullable; 0 to 3 sectors, none null. Condition: both
-- columns or none, value 1 to 80 characters. "IS NOT NULL" is explicit: a CHECK whose result is
-- NULL passes.
ALTER TABLE "public"."Service"
ADD CONSTRAINT "Service_approval_levels_check"
CHECK (
    "approvalSectorIds" IS NOT NULL
    AND cardinality("approvalSectorIds") <= 3
    AND array_position("approvalSectorIds", NULL) IS NULL
);

ALTER TABLE "public"."Service"
ADD CONSTRAINT "Service_approval_condition_check"
CHECK (
    ("approvalConditionFieldId" IS NULL AND "approvalConditionValue" IS NULL)
    OR (
        "approvalConditionFieldId" IS NOT NULL
        AND "approvalConditionValue" IS NOT NULL
        AND char_length("approvalConditionValue") BETWEEN 1 AND 80
    )
);

-- The request's list of level sectors: empty without approval or for requests opened before levels (then no level
-- and no pending sector); with a list, the level is within it and, exactly while pending, the
-- pending sector is the sector of the current level.
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_approval_levels_check"
CHECK (
    "approvalSectorIdsSnapshot" IS NOT NULL
    AND cardinality("approvalSectorIdsSnapshot") <= 3
    AND array_position("approvalSectorIdsSnapshot", NULL) IS NULL
    AND (
        (
            cardinality("approvalSectorIdsSnapshot") = 0
            AND "approvalLevel" IS NULL
            AND "approvalPendingSectorId" IS NULL
        )
        OR (
            cardinality("approvalSectorIdsSnapshot") > 0
            AND "approvalState" IS NOT NULL
            AND "approvalLevel" IS NOT NULL
            AND "approvalLevel" BETWEEN 1 AND cardinality("approvalSectorIdsSnapshot")
            AND ("approvalState" = 'PENDING') = ("approvalPendingSectorId" IS NOT NULL)
            AND (
                "approvalPendingSectorId" IS NULL
                OR "approvalPendingSectorId" = "approvalSectorIdsSnapshot"["approvalLevel"]
            )
        )
    )
);

-- Levels of a decision start at 1 and go up to 3.
ALTER TABLE "public"."RequestApproval"
ADD CONSTRAINT "RequestApproval_level_check"
CHECK ("level" BETWEEN 1 AND 3);
