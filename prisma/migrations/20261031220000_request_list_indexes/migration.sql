-- SPEC 2026-10-31 (busca, filtros e paginação), seção 6. Additive only: list order and pages per reader.

-- CreateIndex
CREATE INDEX "Request_requesterId_createdAt_id_idx" ON "public"."Request"("requesterId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Request_sectorId_createdAt_id_idx" ON "public"."Request"("sectorId", "createdAt", "id");

