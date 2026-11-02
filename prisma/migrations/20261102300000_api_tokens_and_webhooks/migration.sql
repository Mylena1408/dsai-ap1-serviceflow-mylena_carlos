-- SPEC 2026-11-02 (API externa com tokens e webhooks), seção 6. Additive only: no token and no
-- webhook exists, so nothing changes until someone creates one (guarantee 7.4). The new audit
-- values are not used in this migration, as PostgreSQL requires for ADD VALUE in a transaction.

-- CreateEnum
CREATE TYPE "public"."ApiTokenScope" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "public"."WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."AuditAction" ADD VALUE 'REVOKED';
ALTER TYPE "public"."AuditAction" ADD VALUE 'SECRET_ROTATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."AuditEntityType" ADD VALUE 'API_TOKEN';
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'WEBHOOK';

-- CreateTable
CREATE TABLE "public"."ApiToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "public"."ApiTokenScope" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastFour" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastUsedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiRateWindow" (
    "tokenId" UUID NOT NULL,
    "windowStart" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "ApiRateWindow_pkey" PRIMARY KEY ("tokenId","windowStart")
);

-- CreateTable
CREATE TABLE "public"."WebhookEndpoint" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "encryptedSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookDelivery" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "status" "public"."WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "deliveredAt" TIMESTAMPTZ,
    "lastErrorCode" TEXT,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "public"."ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_createdAt_idx" ON "public"."ApiToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRateWindow_windowStart_idx" ON "public"."ApiRateWindow"("windowStart");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_availableAt_idx" ON "public"."WebhookDelivery"("status", "availableAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "public"."WebhookDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_eventId_endpointId_key" ON "public"."WebhookDelivery"("eventId", "endpointId");

-- AddForeignKey
ALTER TABLE "public"."ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiToken" ADD CONSTRAINT "ApiToken_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiRateWindow" ADD CONSTRAINT "ApiRateWindow_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "public"."ApiToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "public"."WebhookEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules of section 5.1: a trimmed name of 1 to 60 characters, a SHA-256 in hexadecimal, the last
-- four characters of the value, expiry after creation, and revocation with its author.
ALTER TABLE "public"."ApiToken"
ADD CONSTRAINT "ApiToken_name_check"
CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 60);

ALTER TABLE "public"."ApiToken"
ADD CONSTRAINT "ApiToken_tokenHash_check"
CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "public"."ApiToken"
ADD CONSTRAINT "ApiToken_lastFour_check"
CHECK (char_length("lastFour") = 4);

ALTER TABLE "public"."ApiToken"
ADD CONSTRAINT "ApiToken_expiresAt_check"
CHECK ("expiresAt" > "createdAt");

ALTER TABLE "public"."ApiToken"
ADD CONSTRAINT "ApiToken_revocation_check"
CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL));

ALTER TABLE "public"."ApiRateWindow"
ADD CONSTRAINT "ApiRateWindow_count_check"
CHECK ("count" >= 1);

-- Section 5.6: at least one known event type, the same list the outbox accepts.
ALTER TABLE "public"."WebhookEndpoint"
ADD CONSTRAINT "WebhookEndpoint_name_check"
CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 60);

ALTER TABLE "public"."WebhookEndpoint"
ADD CONSTRAINT "WebhookEndpoint_url_check"
CHECK (char_length("url") BETWEEN 1 AND 2000);

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
      'request.approval_decided'
    ]::TEXT[]
);

ALTER TABLE "public"."WebhookDelivery"
ADD CONSTRAINT "WebhookDelivery_attempts_check"
CHECK (
    "attempts" BETWEEN 0 AND 6
    AND ("lastErrorCode" IS NULL OR char_length("lastErrorCode") BETWEEN 1 AND 64)
);

ALTER TABLE "public"."WebhookDelivery"
ADD CONSTRAINT "WebhookDelivery_deliveredAt_check"
CHECK (("status" = 'DELIVERED') = ("deliveredAt" IS NOT NULL));
