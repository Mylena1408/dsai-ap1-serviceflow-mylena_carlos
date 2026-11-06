-- CreateIndex
CREATE INDEX "RequestStatusEvent_requestId_occurredAt_id_idx" ON "public"."RequestStatusEvent"("requestId", "occurredAt", "id");

