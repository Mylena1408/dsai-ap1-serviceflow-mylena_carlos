-- SPEC 2026-11-06-aprofundamento-configurabilidade, seção 7.4 (SF-173). Additive: a new enum, a new
-- table, columns with defaults or nullable (the existing escalations read as the option, OVERDUE),
-- one more audit entity type and the rules below.

-- CreateEnum
CREATE TYPE "public"."EscalationTrigger" AS ENUM ('OVERDUE', 'DUE_SOON', 'OVERDUE_DAYS');

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'ESCALATION_RULE';

-- AlterTable
ALTER TABLE "public"."RequestEscalation" ADD COLUMN     "assignedToId" UUID,
ADD COLUMN     "assignmentSkipped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueAt" TIMESTAMPTZ,
ADD COLUMN     "overdueDays" INTEGER,
ADD COLUMN     "ruleId" UUID,
ADD COLUMN     "ruleName" TEXT,
ADD COLUMN     "trigger" "public"."EscalationTrigger" NOT NULL DEFAULT 'OVERDUE';

-- CreateTable
CREATE TABLE "public"."SectorEscalationRule" (
    "id" UUID NOT NULL,
    "sectorId" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "trigger" "public"."EscalationTrigger" NOT NULL,
    "overdueDays" INTEGER,
    "raisePriority" BOOLEAN NOT NULL DEFAULT false,
    "assignToId" UUID,
    "notifyManagers" BOOLEAN NOT NULL DEFAULT false,
    "notifyTeam" BOOLEAN NOT NULL DEFAULT false,
    "notifyUserIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SectorEscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectorEscalationRule_sectorId_idx" ON "public"."SectorEscalationRule"("sectorId");

-- AddForeignKey
ALTER TABLE "public"."RequestEscalation" ADD CONSTRAINT "RequestEscalation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."SectorEscalationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestEscalation" ADD CONSTRAINT "RequestEscalation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SectorEscalationRule" ADD CONSTRAINT "SectorEscalationRule_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SectorEscalationRule" ADD CONSTRAINT "SectorEscalationRule_assignToId_fkey" FOREIGN KEY ("assignToId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 7.3 item 1: in a sector, the active rules have distinct names and distinct trigger and N.
CREATE UNIQUE INDEX "SectorEscalationRule_name_active_key" ON "public"."SectorEscalationRule" ("sectorId", "name") WHERE "isActive" = true;
CREATE UNIQUE INDEX "SectorEscalationRule_trigger_active_key" ON "public"."SectorEscalationRule" ("sectorId", "trigger", (coalesce("overdueDays", 0))) WHERE "isActive" = true;

-- The people a rule warns: up to 10, none null or repeated.
CREATE FUNCTION "public"."escalation_rule_people_valid"(people UUID[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(people) <= 10
     AND array_position(people, NULL) IS NULL
     AND (SELECT count(DISTINCT item) FROM unnest(people) AS item) = cardinality(people)
$$;

-- Name 1 to 60 characters without surrounding spaces; OVERDUE is the option's, not a rule's; N only
-- with "vencida há N dias", from 1 to 30; at least one action or recipient.
-- "IS NOT NULL" is explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."SectorEscalationRule"
ADD CONSTRAINT "SectorEscalationRule_values_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 60
    AND (
        ("trigger" = 'DUE_SOON' AND "overdueDays" IS NULL)
        OR ("trigger" = 'OVERDUE_DAYS' AND "overdueDays" IS NOT NULL AND "overdueDays" BETWEEN 1 AND 30)
    )
    AND "notifyUserIds" IS NOT NULL
    AND "public"."escalation_rule_people_valid"("notifyUserIds")
    AND ("raisePriority" OR "assignToId" IS NOT NULL OR "notifyManagers" OR "notifyTeam" OR cardinality("notifyUserIds") > 0)
);

-- A rule's escalation keeps the rule's name, the due date and the N; the option's keeps none of the
-- rule data. A skipped handover has no attendant.
ALTER TABLE "public"."RequestEscalation"
ADD CONSTRAINT "RequestEscalation_trigger_check"
CHECK (
    (
        "trigger" = 'OVERDUE'
        AND "ruleId" IS NULL
        AND "ruleName" IS NULL
        AND "overdueDays" IS NULL
        AND "assignedToId" IS NULL
        AND NOT "assignmentSkipped"
    )
    OR (
        "trigger" <> 'OVERDUE'
        AND "ruleName" IS NOT NULL
        AND "dueAt" IS NOT NULL
        AND (
            ("trigger" = 'DUE_SOON' AND "overdueDays" IS NULL)
            OR ("trigger" = 'OVERDUE_DAYS' AND "overdueDays" IS NOT NULL AND "overdueDays" BETWEEN 1 AND 30)
        )
        AND NOT ("assignedToId" IS NOT NULL AND "assignmentSkipped")
    )
);

-- 7.3 item 2: a rule applies once per request and due date, also with two runs at once.
CREATE UNIQUE INDEX "RequestEscalation_rule_due_key" ON "public"."RequestEscalation" ("requestId", "ruleId", "dueAt") WHERE "ruleId" IS NOT NULL;
