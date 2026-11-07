-- SPEC 2026-11-07-operacao-e-automacao, seções 4.3 e 4.4 (SF-180). Additive: two enums, columns with
-- defaults or nullable (every sector keeps distribution off), a new table and the rules below.
-- The assignment changes the system already made (escalation rules, SF-174) get their reason.

-- CreateEnum
CREATE TYPE "public"."DistributionMode" AS ENUM ('NONE', 'ROUND_ROBIN', 'LEAST_LOAD');

-- CreateEnum
CREATE TYPE "public"."AssignmentReason" AS ENUM ('DISTRIBUTION', 'ABSENCE', 'ESCALATION_RULE');

-- AlterTable
ALTER TABLE "public"."Sector" ADD COLUMN     "distributionMode" "public"."DistributionMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "lastDistributedToId" UUID,
ADD COLUMN     "maxActivePerAttendant" INTEGER,
ADD COLUMN     "redistributeOnAbsence" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."RequestAssignmentEvent" ADD COLUMN     "reason" "public"."AssignmentReason";

-- CreateTable
CREATE TABLE "public"."AttendantAbsence" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ,
    "redistributedAt" TIMESTAMPTZ,

    CONSTRAINT "AttendantAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendantAbsence_userId_startsOn_idx" ON "public"."AttendantAbsence"("userId", "startsOn");

-- AddForeignKey
ALTER TABLE "public"."Sector" ADD CONSTRAINT "Sector_lastDistributedToId_fkey" FOREIGN KEY ("lastDistributedToId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttendantAbsence" ADD CONSTRAINT "AttendantAbsence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttendantAbsence" ADD CONSTRAINT "AttendantAbsence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 4.3 item 1: the limit goes from 1 to 100, or there is none.
ALTER TABLE "public"."Sector"
ADD CONSTRAINT "Sector_maxActivePerAttendant_check"
CHECK ("maxActivePerAttendant" IS NULL OR "maxActivePerAttendant" BETWEEN 1 AND 100);

-- Decision H19: the reason exists exactly when the system made the change. The only changes without
-- an author before this migration came from the escalation rules.
UPDATE "public"."RequestAssignmentEvent" SET "reason" = 'ESCALATION_RULE' WHERE "actorId" IS NULL;

ALTER TABLE "public"."RequestAssignmentEvent"
ADD CONSTRAINT "RequestAssignmentEvent_reason_check"
CHECK (("actorId" IS NULL) = ("reason" IS NOT NULL));

-- 4.3 item 7: a period of 1 to 90 days, the end not before the start; the cancellation and the
-- handover are moments, set at most once.
ALTER TABLE "public"."AttendantAbsence"
ADD CONSTRAINT "AttendantAbsence_period_check"
CHECK ("endsOn" >= "startsOn" AND "endsOn" - "startsOn" <= 89);
