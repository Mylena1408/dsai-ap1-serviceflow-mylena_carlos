-- SPEC 2026-11-01 (SLA e prioridades), seção 6, atualização da SF-068. Additive only.
-- "dueSoonAt" is the instant a request enters "próximo do vencimento" (seção 5.4):
-- the due date minus 20% of the effective SLA. The queue filters on it; Prisma cannot
-- express that per-row arithmetic in a filter. A trigger keeps it in sync with the
-- due date, the priority and the SLA snapshot on every write.

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN "dueSoonAt" TIMESTAMPTZ;

-- 20% of the effective SLA in minutes: slaHours * 60 * factor * 0.2, with the factors of
-- seção 5.2 (Urgente 25%, Alta 50%, Normal 100%, Baixa 200%). Exact for whole hours.
CREATE FUNCTION "public"."request_due_soon_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."dueSoonAt" := CASE
    WHEN NEW."dueAt" IS NULL OR NEW."slaHoursSnapshot" IS NULL THEN NULL
    ELSE NEW."dueAt" - NEW."slaHoursSnapshot" * (CASE NEW."priority"
      WHEN 'URGENT' THEN 3
      WHEN 'HIGH' THEN 6
      WHEN 'NORMAL' THEN 12
      WHEN 'LOW' THEN 24
    END) * INTERVAL '1 minute'
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Request_dueSoonAt_sync"
BEFORE INSERT OR UPDATE OF "dueAt", "priority", "slaHoursSnapshot", "dueSoonAt"
ON "public"."Request"
FOR EACH ROW EXECUTE FUNCTION "public"."request_due_soon_at"();

-- Existing requests with a due date (the trigger computes the value).
UPDATE "public"."Request" SET "dueSoonAt" = NULL WHERE "dueAt" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Request_sectorId_dueSoonAt_idx" ON "public"."Request"("sectorId", "dueSoonAt");
