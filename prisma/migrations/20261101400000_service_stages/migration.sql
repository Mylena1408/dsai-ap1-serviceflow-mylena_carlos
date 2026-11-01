-- SPEC 2026-11-01 (fluxos configuráveis), seção 6. Additive, except the outbox type CHECK, which is
-- recreated wider (same procedure as the SLA migration); no data is lost.

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "stageIndex" INTEGER,
ADD COLUMN     "stageNamesSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "public"."ServiceStage" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ServiceStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestStageEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceStage_serviceId_idx" ON "public"."ServiceStage"("serviceId");

-- CreateIndex
CREATE INDEX "RequestStageEvent_requestId_idx" ON "public"."RequestStageEvent"("requestId");

-- AddForeignKey
ALTER TABLE "public"."ServiceStage" ADD CONSTRAINT "ServiceStage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestStageEvent" ADD CONSTRAINT "RequestStageEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestStageEvent" ADD CONSTRAINT "RequestStageEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Stage names are unique per service among active stages, case-insensitively (citext) (SPEC 5.1).
CREATE UNIQUE INDEX "ServiceStage_serviceId_name_active_key"
ON "public"."ServiceStage" ("serviceId", "name")
WHERE "isActive" = true;

ALTER TABLE "public"."ServiceStage"
ADD CONSTRAINT "ServiceStage_name_check"
CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 60);

ALTER TABLE "public"."ServiceStage"
ADD CONSTRAINT "ServiceStage_position_check"
CHECK ("position" >= 0);

-- A stage snapshot holds at most 8 trimmed names of 1 to 60 characters, without case-insensitive repeats.
CREATE FUNCTION "public"."request_stage_names_valid"(names TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(bool_and(name IS NOT NULL AND name = btrim(name) AND char_length(name) BETWEEN 1 AND 60), true)
     AND count(DISTINCT lower(name)) = count(*)
     AND count(*) <= 8
  FROM unnest(names) AS name
$$;

-- The stage exists exactly when there is a snapshot, points inside it and never on an open request
-- (reopening clears both, SPEC 5.4).
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_stage_check"
CHECK (
    "stageNamesSnapshot" IS NOT NULL
    AND "public"."request_stage_names_valid"("stageNamesSnapshot")
    AND ("stageIndex" IS NULL) = (cardinality("stageNamesSnapshot") = 0)
    AND ("stageIndex" IS NULL OR "stageIndex" BETWEEN 0 AND cardinality("stageNamesSnapshot") - 1)
    AND ("status" <> 'OPEN' OR "stageIndex" IS NULL)
);

ALTER TABLE "public"."RequestStageEvent"
ADD CONSTRAINT "RequestStageEvent_stage_check"
CHECK (
    char_length("toStage") BETWEEN 1 AND 60
    AND ("fromStage" IS NULL OR char_length("fromStage") BETWEEN 1 AND 60)
    AND "fromStage" IS DISTINCT FROM "toStage"
    AND ("note" IS NULL OR char_length("note") BETWEEN 1 AND 1000)
);

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
  'request.stage_changed'
));
