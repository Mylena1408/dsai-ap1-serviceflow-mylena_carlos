-- SPEC 2026-10-31 (eventos, outbox e jobs), seção 9. Additive only.

-- CreateTable
CREATE TABLE "public"."OutboxEvent" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "availableAt" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMPTZ,
    "failedAt" TIMESTAMPTZ,
    "lastErrorCode" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestNotification" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "eventId" UUID,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "readAt" TIMESTAMPTZ,

    CONSTRAINT "RequestNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_failedAt_availableAt_idx" ON "public"."OutboxEvent"("processedAt", "failedAt", "availableAt");

-- CreateIndex
CREATE INDEX "RequestNotification_recipientId_readAt_createdAt_idx" ON "public"."RequestNotification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestNotification_eventId_recipientId_key" ON "public"."RequestNotification"("eventId", "recipientId");

-- AddForeignKey
ALTER TABLE "public"."OutboxEvent" ADD CONSTRAINT "OutboxEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestNotification" ADD CONSTRAINT "RequestNotification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestNotification" ADD CONSTRAINT "RequestNotification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestNotification" ADD CONSTRAINT "RequestNotification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Known event types only (SPEC seção 6.1).
ALTER TABLE "public"."OutboxEvent"
ADD CONSTRAINT "OutboxEvent_type_check"
CHECK ("type" IN ('request.opened', 'request.status_changed', 'request.assignment_changed', 'request.comment_added'));

-- Payload is an object of identifiers and codes; errors are stored as short codes only (seção 6.2).
ALTER TABLE "public"."OutboxEvent"
ADD CONSTRAINT "OutboxEvent_payload_check"
CHECK (jsonb_typeof("payload") = 'object');

ALTER TABLE "public"."OutboxEvent"
ADD CONSTRAINT "OutboxEvent_attempts_check"
CHECK ("attempts" >= 0 AND ("lastErrorCode" IS NULL OR char_length("lastErrorCode") BETWEEN 1 AND 64));
