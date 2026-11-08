-- SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 3: the event `request.tags_changed`. The outbox and the
-- webhooks list the event types they accept; both lists gain the new one, the rest stays the same.

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
  'request.escalated',
  'request.tags_changed'
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
      'request.escalated',
      'request.tags_changed'
    ]::TEXT[]
);
