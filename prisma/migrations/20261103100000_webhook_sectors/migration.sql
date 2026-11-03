-- SPEC 2026-11-03 (ações pela API e webhooks por setor), seção 6. Additive only: existing webhooks
-- get an empty list, which means every sector, so they keep receiving what they receive today.

-- AlterTable
ALTER TABLE "public"."WebhookEndpoint" ADD COLUMN     "sectorIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- Section 5.2: the list is never null and has no null item (an empty list means every sector).
ALTER TABLE "public"."WebhookEndpoint"
ADD CONSTRAINT "WebhookEndpoint_sectorIds_check"
CHECK ("sectorIds" IS NOT NULL AND array_position("sectorIds", NULL) IS NULL);
