-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 4.3.5 e 4.4 (SF-165). Additive: one
-- new table and one nullable column; no existing row changes.

-- AlterTable
ALTER TABLE "public"."RequestApproval" ADD COLUMN     "onBehalfOfId" UUID;

-- CreateTable
CREATE TABLE "public"."ManagerAbsence" (
    "id" UUID NOT NULL,
    "managerId" UUID NOT NULL,
    "substituteId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ,

    CONSTRAINT "ManagerAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagerAbsence_managerId_endsOn_idx" ON "public"."ManagerAbsence"("managerId", "endsOn");

-- CreateIndex
CREATE INDEX "ManagerAbsence_substituteId_endsOn_idx" ON "public"."ManagerAbsence"("substituteId", "endsOn");

-- AddForeignKey
ALTER TABLE "public"."RequestApproval" ADD CONSTRAINT "RequestApproval_onBehalfOfId_fkey" FOREIGN KEY ("onBehalfOfId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ManagerAbsence" ADD CONSTRAINT "ManagerAbsence_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ManagerAbsence" ADD CONSTRAINT "ManagerAbsence_substituteId_fkey" FOREIGN KEY ("substituteId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ManagerAbsence" ADD CONSTRAINT "ManagerAbsence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The period: end not before the start, at most 90 days (both days count), and somebody else as the
-- substitute. Overlapping periods of the same manager are refused by the application, inside a
-- serializable transaction (an exclusion constraint would need the btree_gist extension).
ALTER TABLE "public"."ManagerAbsence"
ADD CONSTRAINT "ManagerAbsence_period_check"
CHECK ("endsOn" >= "startsOn" AND "endsOn" - "startsOn" <= 89 AND "managerId" <> "substituteId");

-- A decision on behalf of someone is made by somebody else.
ALTER TABLE "public"."RequestApproval"
ADD CONSTRAINT "RequestApproval_on_behalf_check"
CHECK ("onBehalfOfId" IS NULL OR "onBehalfOfId" <> "deciderId");
