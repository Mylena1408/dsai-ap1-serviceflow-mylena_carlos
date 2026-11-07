-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 5.3.1 e 5.3.2 (SF-169). Additive: one
-- column with a default (existing history rows are "attendant available") and one more event type,
-- accepted by the outbox and the webhooks (constraints recreated wider, as in earlier SPECs).

-- AlterTable
ALTER TABLE "public"."RequestStageEvent" ADD COLUMN     "assigneeUnavailable" BOOLEAN NOT NULL DEFAULT false;

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
  'request.stage_overdue'
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
      'request.stage_overdue'
    ]::TEXT[]
);
