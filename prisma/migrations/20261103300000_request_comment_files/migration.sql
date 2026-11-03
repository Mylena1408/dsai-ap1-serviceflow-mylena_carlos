-- SPEC 2026-11-03 (anexos em comentários e documentos depois da abertura), seção 6. Additive,
-- except the type CHECKs of the outbox and of the webhooks, which are recreated only to accept
-- "request.document_added": every value accepted before is still accepted.

-- CreateTable
CREATE TABLE "public"."RequestCommentFile" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "commentId" UUID NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "detectedFormat" "public"."DocumentFormat" NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "removedAt" TIMESTAMPTZ,

    CONSTRAINT "RequestCommentFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestCommentFile_storageKey_key" ON "public"."RequestCommentFile"("storageKey");

-- CreateIndex
CREATE INDEX "RequestCommentFile_commentId_idx" ON "public"."RequestCommentFile"("commentId");

-- CreateIndex
CREATE INDEX "RequestCommentFile_requestId_idx" ON "public"."RequestCommentFile"("requestId");

-- CreateIndex
CREATE INDEX "RequestCommentFile_uploadedById_idx" ON "public"."RequestCommentFile"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "RequestComment_id_requestId_key" ON "public"."RequestComment"("id", "requestId");

-- AddForeignKey
ALTER TABLE "public"."RequestCommentFile" ADD CONSTRAINT "RequestCommentFile_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestCommentFile" ADD CONSTRAINT "RequestCommentFile_commentId_requestId_fkey" FOREIGN KEY ("commentId", "requestId") REFERENCES "public"."RequestComment"("id", "requestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestCommentFile" ADD CONSTRAINT "RequestCommentFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Same row rules as RequestAttachment (SPEC 2026-09-30, section 21).
ALTER TABLE "public"."RequestCommentFile"
ADD CONSTRAINT "RequestCommentFile_originalFilename_check"
CHECK (
    char_length("originalFilename") BETWEEN 1 AND 255
    AND "originalFilename" !~ '[/\\[:cntrl:]]'
);

ALTER TABLE "public"."RequestCommentFile"
ADD CONSTRAINT "RequestCommentFile_contentType_check"
CHECK (
    ("detectedFormat" = 'PDF' AND "contentType" = 'application/pdf')
    OR ("detectedFormat" = 'DOCX' AND "contentType" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR ("detectedFormat" = 'TXT' AND "contentType" = 'text/plain')
);

ALTER TABLE "public"."RequestCommentFile"
ADD CONSTRAINT "RequestCommentFile_sizeBytes_check"
CHECK ("sizeBytes" BETWEEN 1 AND 2097152);

ALTER TABLE "public"."RequestCommentFile"
ADD CONSTRAINT "RequestCommentFile_sha256_check"
CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Opaque key in the folder of the request, so the orphan cleanup keeps treating it by request.
ALTER TABLE "public"."RequestCommentFile"
ADD CONSTRAINT "RequestCommentFile_storageKey_check"
CHECK ("storageKey" = 'requests/' || "requestId"::text || '/' || "id"::text);

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
  'request.document_added'
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
      'request.document_added'
    ]::TEXT[]
);
