-- SPEC 2026-11-01 (permissões configuráveis), seção 6. Additive only: nobody starts with a permission.

-- CreateEnum
CREATE TYPE "public"."Permission" AS ENUM ('SECTOR_SERVICES', 'SECTOR_REQUESTS_READ', 'QUEUE_SUPERVISION');

-- CreateEnum
CREATE TYPE "public"."PermissionAction" AS ENUM ('GRANTED', 'REVOKED');

-- CreateTable
CREATE TABLE "public"."UserPermission" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "permission" "public"."Permission" NOT NULL,
    "grantedById" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserPermissionEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "permission" "public"."Permission" NOT NULL,
    "action" "public"."PermissionAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "UserPermissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "public"."UserPermission"("userId", "permission");

-- CreateIndex
CREATE INDEX "UserPermissionEvent_userId_occurredAt_idx" ON "public"."UserPermissionEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermission" ADD CONSTRAINT "UserPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionEvent" ADD CONSTRAINT "UserPermissionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserPermissionEvent" ADD CONSTRAINT "UserPermissionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

