-- SPEC 2026-11-06-pesquisa-satisfacao, seção 5. Additive only: two new tables, their indexes,
-- foreign keys and CHECKs. Nothing that exists changes.

-- CreateTable
CREATE TABLE "public"."RequestSatisfaction" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "completedAtSnapshot" TIMESTAMPTZ NOT NULL,
    "ratedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestSatisfaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestSatisfactionEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "replaced" BOOLEAN NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestSatisfactionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestSatisfaction_requestId_key" ON "public"."RequestSatisfaction"("requestId");

-- CreateIndex
CREATE INDEX "RequestSatisfaction_ratedAt_idx" ON "public"."RequestSatisfaction"("ratedAt");

-- CreateIndex
CREATE INDEX "RequestSatisfactionEvent_requestId_idx" ON "public"."RequestSatisfactionEvent"("requestId");

-- AddForeignKey
ALTER TABLE "public"."RequestSatisfaction" ADD CONSTRAINT "RequestSatisfaction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSatisfaction" ADD CONSTRAINT "RequestSatisfaction_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSatisfactionEvent" ADD CONSTRAINT "RequestSatisfactionEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestSatisfactionEvent" ADD CONSTRAINT "RequestSatisfactionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rating from 1 to 5 (4.2); an optional comment is never empty and has at most 1,000 characters.
ALTER TABLE "public"."RequestSatisfaction" ADD CONSTRAINT "RequestSatisfaction_rating_check"
  CHECK ("rating" IS NOT NULL AND "rating" BETWEEN 1 AND 5);
ALTER TABLE "public"."RequestSatisfaction" ADD CONSTRAINT "RequestSatisfaction_comment_check"
  CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 1000);
ALTER TABLE "public"."RequestSatisfactionEvent" ADD CONSTRAINT "RequestSatisfactionEvent_rating_check"
  CHECK ("rating" IS NOT NULL AND "rating" BETWEEN 1 AND 5);
