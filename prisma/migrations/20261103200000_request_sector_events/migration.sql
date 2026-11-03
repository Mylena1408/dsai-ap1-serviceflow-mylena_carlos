-- SPEC 2026-11-03 (transferência entre setores), seção 6. Additive, except the type CHECKs of the
-- outbox and of the webhooks, which are recreated only to accept "request.sector_changed": every
-- value accepted before is still accepted.

-- CreateTable
CREATE TABLE "public"."RequestSectorEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromSectorId" UUID NOT NULL,
    "toSectorId" UUID NOT NULL,
    "fromSectorName" TEXT NOT NULL,
    "toSectorName" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestSectorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestSectorEvent_requestId_idx" ON "public"."RequestSectorEvent"("requestId");

-- AddForeignKey
ALTER TABLE "public"."RequestSectorEvent" ADD CONSTRAINT "RequestSectorEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSectorEvent" ADD CONSTRAINT "RequestSectorEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSectorEvent" ADD CONSTRAINT "RequestSectorEvent_fromSectorId_fkey" FOREIGN KEY ("fromSectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSectorEvent" ADD CONSTRAINT "RequestSectorEvent_toSectorId_fkey" FOREIGN KEY ("toSectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Section 5.1 item 4 and 5.2: a mandatory note of 1 to 1,000 characters, already trimmed, and a
-- different destination.
ALTER TABLE "public"."RequestSectorEvent"
ADD CONSTRAINT "RequestSectorEvent_check"
CHECK (
    "note" = btrim("note")
    AND char_length("note") BETWEEN 1 AND 1000
    AND "fromSectorId" <> "toSectorId"
    AND char_length("fromSectorName") >= 1
    AND char_length("toSectorName") >= 1
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
  'request.stage_changed',
  'request.approval_decided',
  'request.sector_changed'
));

ALTER TABLE "public"."WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_eventTypes_check";
ALTER TABLE "public"."WebhookEndpoint"
ADD CONSTRAINT "WebhookEndpoint_eventTypes_check"
CHECK (
    "eventTypes" IS NOT NULL
    AND cardinality("eventTypes") >= 1
    AND "eventTypes" <@ ARRAY[
      'request.opened',
      'request.status_changed',
      'request.assignment_changed',
      'request.comment_added',
      'request.priority_changed',
      'request.sla_warning',
      'request.sla_breached',
      'request.stage_changed',
      'request.approval_decided',
      'request.sector_changed'
    ]::TEXT[]
);
