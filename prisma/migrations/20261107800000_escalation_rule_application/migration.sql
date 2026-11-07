-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 7.3 e 7.4 (SF-174). Additive: the author of
-- an assignment change may be the system (decision G17; existing rows keep their author), the people
-- a rule warned (existing escalations warned nobody through a rule) and one more event type, accepted
-- by the outbox and the webhooks (constraints recreated wider, as in earlier SPECs).

-- AlterTable
ALTER TABLE "public"."RequestAssignmentEvent" ALTER COLUMN "actorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."RequestEscalation" ADD COLUMN     "notifiedUserIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- The list is never null; the option's escalations warn through the breach alert, not this list.
-- "IS NOT NULL" is explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."RequestEscalation"
ADD CONSTRAINT "RequestEscalation_notified_check"
CHECK (
    "notifiedUserIds" IS NOT NULL
    AND array_position("notifiedUserIds", NULL) IS NULL
    AND ("trigger" <> 'OVERDUE' OR cardinality("notifiedUserIds") = 0)
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
  'request.sector_changed',
  'request.document_added',
  'request.sla_paused',
  'request.sla_resumed',
  'request.approval_overdue',
  'request.stage_overdue',
  'request.escalated'
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
      'request.sector_changed',
      'request.document_added',
      'request.sla_paused',
      'request.sla_resumed',
      'request.approval_overdue',
      'request.stage_overdue',
      'request.escalated'
    ]::TEXT[]
);
