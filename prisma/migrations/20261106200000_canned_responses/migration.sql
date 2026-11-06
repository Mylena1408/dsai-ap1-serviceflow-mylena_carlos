-- SPEC 2026-11-06-respostas-prontas, seção 5. Additive only: one new table, its indexes, foreign
-- keys and CHECKs. Nothing that exists changes.

-- CreateTable
CREATE TABLE "public"."CannedResponse" (
    "id" UUID NOT NULL,
    "sectorId" UUID NOT NULL,
    "title" CITEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CannedResponse_sectorId_idx" ON "public"."CannedResponse"("sectorId");

-- AddForeignKey
ALTER TABLE "public"."CannedResponse" ADD CONSTRAINT "CannedResponse_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "public"."Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CannedResponse" ADD CONSTRAINT "CannedResponse_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CannedResponse" ADD CONSTRAINT "CannedResponse_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Title: 1 to 120 characters, no spaces at the ends; body: 1 to 5,000 characters (4.2).
ALTER TABLE "public"."CannedResponse" ADD CONSTRAINT "CannedResponse_title_check"
  CHECK ("title" IS NOT NULL AND char_length("title") BETWEEN 1 AND 120 AND "title" = btrim("title"));
ALTER TABLE "public"."CannedResponse" ADD CONSTRAINT "CannedResponse_body_check"
  CHECK ("body" IS NOT NULL AND char_length("body") BETWEEN 1 AND 5000);

-- One active response per title in a sector; citext makes the comparison case-insensitive (4.2).
CREATE UNIQUE INDEX "CannedResponse_sectorId_title_active_key" ON "public"."CannedResponse"("sectorId", "title") WHERE "isActive";
