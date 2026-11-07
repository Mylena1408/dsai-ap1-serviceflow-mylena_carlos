-- SPEC 2026-11-06-aprofundamento-configurabilidade, seção 5.3.4 (SF-170). Additive: the name of the
-- current stage as a generated column, so the queue filters and indexes it without any code keeping
-- it in sync. PostgreSQL fills it for the existing rows when the column is added; arrays start at 1.

-- AlterTable
ALTER TABLE "public"."Request"
ADD COLUMN "currentStageName" TEXT
GENERATED ALWAYS AS (
    CASE WHEN "stageIndex" IS NULL THEN NULL ELSE "stageNamesSnapshot"["stageIndex" + 1] END
) STORED;

-- CreateIndex
CREATE INDEX "Request_sectorId_currentStageName_idx" ON "public"."Request"("sectorId", "currentStageName");
