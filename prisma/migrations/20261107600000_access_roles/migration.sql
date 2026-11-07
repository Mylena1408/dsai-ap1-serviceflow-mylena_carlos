-- SPEC 2026-11-06-aprofundamento-configurabilidade, seções 6.3 e 6.4 (SF-171). Additive: new tables,
-- nullable columns and one more audit entity type (not used by any constraint here).

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'ACCESS_ROLE';

-- AlterTable
ALTER TABLE "public"."UserPermission" ADD COLUMN     "expiresOn" DATE;

-- AlterTable
ALTER TABLE "public"."UserPermissionEvent" ADD COLUMN     "expiresOn" DATE;

-- CreateTable
CREATE TABLE "public"."AccessRole" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "description" TEXT,
    "permissions" "public"."Permission"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserAccessRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ NOT NULL,
    "expiresOn" DATE,

    CONSTRAINT "UserAccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserAccessRoleEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "action" "public"."PermissionAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "expiresOn" DATE,

    CONSTRAINT "UserAccessRoleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAccessRole_roleId_idx" ON "public"."UserAccessRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccessRole_userId_roleId_key" ON "public"."UserAccessRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "UserAccessRoleEvent_userId_occurredAt_idx" ON "public"."UserAccessRoleEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."AccessRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRole" ADD CONSTRAINT "UserAccessRole_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRoleEvent" ADD CONSTRAINT "UserAccessRoleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRoleEvent" ADD CONSTRAINT "UserAccessRoleEvent_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."AccessRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserAccessRoleEvent" ADD CONSTRAINT "UserAccessRoleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Role names are unique among the active roles, ignoring case (citext), as the stages and fields.
CREATE UNIQUE INDEX "AccessRole_name_active_key" ON "public"."AccessRole" ("name") WHERE "isActive" = true;

-- A role's permissions: 1 to 3, none null or repeated.
CREATE FUNCTION "public"."access_role_permissions_valid"(permissions "public"."Permission"[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(permissions) BETWEEN 1 AND 3
     AND array_position(permissions, NULL) IS NULL
     AND (SELECT count(DISTINCT item) FROM unnest(permissions) AS item) = cardinality(permissions)
$$;

-- Name 1 to 60 characters without surrounding spaces; description absent or 1 to 200 the same way.
-- "IS NOT NULL" is explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."AccessRole"
ADD CONSTRAINT "AccessRole_values_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 60
    AND ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") BETWEEN 1 AND 200))
    AND "permissions" IS NOT NULL
    AND "public"."access_role_permissions_valid"("permissions")
);
