-- SPEC 2026-11-06-escalonamento, seção 5. Additive only: a column with a default (false: nothing
-- changes for existing sectors) and a new table with its indexes and foreign key.

-- AlterTable
ALTER TABLE "public"."Sector" ADD COLUMN     "escalateOverdue" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."RequestEscalation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "fromPriority" "public"."RequestPriority" NOT NULL,
    "toPriority" "public"."RequestPriority" NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestEscalation_requestId_idx" ON "public"."RequestEscalation"("requestId");

-- CreateIndex
CREATE INDEX "RequestEscalation_occurredAt_idx" ON "public"."RequestEscalation"("occurredAt");

-- AddForeignKey
ALTER TABLE "public"."RequestEscalation" ADD CONSTRAINT "RequestEscalation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

