-- SPEC 2026-11-07-operacao-e-automacao, seções 3.3 (regra 1) e 3.4 (SF-175). Additive: two enums and
-- two tables with their constraints; no existing row changes.

-- CreateEnum
CREATE TYPE "public"."RequestLinkKind" AS ENUM ('RELATED', 'DUPLICATE_OF');

-- CreateEnum
CREATE TYPE "public"."RequestLinkAction" AS ENUM ('LINKED', 'UNLINKED');

-- CreateTable
CREATE TABLE "public"."RequestLink" (
    "id" UUID NOT NULL,
    "fromRequestId" UUID NOT NULL,
    "toRequestId" UUID NOT NULL,
    "kind" "public"."RequestLinkKind" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestLinkEvent" (
    "id" UUID NOT NULL,
    "fromRequestId" UUID NOT NULL,
    "toRequestId" UUID NOT NULL,
    "kind" "public"."RequestLinkKind" NOT NULL,
    "action" "public"."RequestLinkAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestLinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestLink_fromRequestId_idx" ON "public"."RequestLink"("fromRequestId");

-- CreateIndex
CREATE INDEX "RequestLink_toRequestId_idx" ON "public"."RequestLink"("toRequestId");

-- CreateIndex
CREATE INDEX "RequestLinkEvent_fromRequestId_occurredAt_idx" ON "public"."RequestLinkEvent"("fromRequestId", "occurredAt");

-- CreateIndex
CREATE INDEX "RequestLinkEvent_toRequestId_occurredAt_idx" ON "public"."RequestLinkEvent"("toRequestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."RequestLink" ADD CONSTRAINT "RequestLink_fromRequestId_fkey" FOREIGN KEY ("fromRequestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestLink" ADD CONSTRAINT "RequestLink_toRequestId_fkey" FOREIGN KEY ("toRequestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestLink" ADD CONSTRAINT "RequestLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestLinkEvent" ADD CONSTRAINT "RequestLinkEvent_fromRequestId_fkey" FOREIGN KEY ("fromRequestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestLinkEvent" ADD CONSTRAINT "RequestLinkEvent_toRequestId_fkey" FOREIGN KEY ("toRequestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestLinkEvent" ADD CONSTRAINT "RequestLinkEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A request is not linked to itself, in the links and in their history.
ALTER TABLE "public"."RequestLink" ADD CONSTRAINT "RequestLink_not_self_check" CHECK ("fromRequestId" <> "toRequestId");
ALTER TABLE "public"."RequestLinkEvent" ADD CONSTRAINT "RequestLinkEvent_not_self_check" CHECK ("fromRequestId" <> "toRequestId");

-- One link per pair, whatever the kind and the direction.
CREATE UNIQUE INDEX "RequestLink_pair_key" ON "public"."RequestLink" (LEAST("fromRequestId", "toRequestId"), GREATEST("fromRequestId", "toRequestId"));

-- A request duplicates at most one other.
CREATE UNIQUE INDEX "RequestLink_one_original_key" ON "public"."RequestLink" ("fromRequestId") WHERE "kind" = 'DUPLICATE_OF';
