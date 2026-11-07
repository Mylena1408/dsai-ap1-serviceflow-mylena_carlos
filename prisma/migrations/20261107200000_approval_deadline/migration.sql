-- SPEC 2026-11-06-aprofundamento-configurabilidade, seção 4.3.6 (SF-166). Additive: nullable
-- columns, constraints that existing rows already meet (all new columns are null) and one more
-- event type, accepted by the outbox and the webhooks (constraints recreated wider).

-- AlterTable
ALTER TABLE "public"."Service" ADD COLUMN     "approvalDeadlineDays" INTEGER;

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "approvalDeadlineDaysSnapshot" INTEGER,
ADD COLUMN     "approvalDueAt" TIMESTAMPTZ,
ADD COLUMN     "approvalOverdueNotifiedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "public"."RequestApproval" ADD COLUMN     "dueAt" TIMESTAMPTZ;

ALTER TABLE "public"."Service"
ADD CONSTRAINT "Service_approvalDeadlineDays_check"
CHECK ("approvalDeadlineDays" IS NULL OR "approvalDeadlineDays" BETWEEN 1 AND 30);

-- The days per level go with a level list; a due date exists only while a level is pending and
-- the request has days; the delay is announced only for a due date.
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_approval_deadline_check"
CHECK (
    ("approvalDeadlineDaysSnapshot" IS NULL OR (
        "approvalDeadlineDaysSnapshot" BETWEEN 1 AND 30
        AND cardinality("approvalSectorIdsSnapshot") > 0
    ))
    AND ("approvalDueAt" IS NULL OR (
        "approvalState" IS NOT NULL
        AND "approvalState" = 'PENDING'
        AND "approvalDeadlineDaysSnapshot" IS NOT NULL
    ))
    AND ("approvalOverdueNotifiedAt" IS NULL OR "approvalDueAt" IS NOT NULL)
);

CREATE INDEX "Request_approvalDueAt_idx" ON "public"."Request"("approvalDueAt");

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
  'request.approval_overdue'
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
      'request.approval_overdue'
    ]::TEXT[]
);
