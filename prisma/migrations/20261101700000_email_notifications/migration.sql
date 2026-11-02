-- SPEC 2026-11-01 (notificações por e-mail e preferências), seção 6. Additive only: nobody starts
-- with email turned on and no delivery exists.

-- CreateEnum
CREATE TYPE "public"."NotificationCategory" AS ENUM ('STATUS', 'ASSIGNMENT', 'COMMENTS', 'SLA', 'STAGES', 'APPROVALS');

-- CreateEnum
CREATE TYPE "public"."EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "public"."NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "public"."NotificationCategory" NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "status" "public"."EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "sentAt" TIMESTAMPTZ,
    "lastErrorCode" TEXT,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_key" ON "public"."NotificationPreference"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_notificationId_key" ON "public"."EmailDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_availableAt_idx" ON "public"."EmailDelivery"("status", "availableAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_createdAt_idx" ON "public"."EmailDelivery"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailDelivery" ADD CONSTRAINT "EmailDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."RequestNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailDelivery" ADD CONSTRAINT "EmailDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

