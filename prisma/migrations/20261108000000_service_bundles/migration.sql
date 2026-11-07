-- SPEC 2026-11-07-operacao-e-automacao, seções 3.3 (regras 2 a 4) e 3.4 (SF-177). Additive: two tables,
-- one nullable column on the requests (existing requests belong to no group), one more audit entity
-- type and the rules below.

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'SERVICE_BUNDLE';

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "groupId" UUID;

-- CreateTable
CREATE TABLE "public"."ServiceBundle" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "description" TEXT,
    "serviceIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ServiceBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequestGroup" (
    "id" UUID NOT NULL,
    "bundleId" UUID,
    "bundleNameSnapshot" TEXT NOT NULL,
    "requesterId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestGroup_requesterId_createdAt_idx" ON "public"."RequestGroup"("requesterId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Request" ADD CONSTRAINT "Request_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."RequestGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestGroup" ADD CONSTRAINT "RequestGroup_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "public"."ServiceBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestGroup" ADD CONSTRAINT "RequestGroup_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The requests of a group, read by the group page and the "Pacote" block.
CREATE INDEX "Request_groupId_idx" ON "public"."Request" ("groupId") WHERE "groupId" IS NOT NULL;

-- Names unique among the active bundles, ignoring case (citext).
CREATE UNIQUE INDEX "ServiceBundle_name_active_key" ON "public"."ServiceBundle" ("name") WHERE "isActive" = true;

-- The services of a bundle: 2 to 5, none null or repeated, in order.
CREATE FUNCTION "public"."service_bundle_services_valid"(services UUID[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(services) BETWEEN 2 AND 5
     AND array_position(services, NULL) IS NULL
     AND (SELECT count(DISTINCT item) FROM unnest(services) AS item) = cardinality(services)
$$;

-- Name 1 to 80 characters without surrounding spaces; description absent or 1 to 500 the same way.
-- "IS NOT NULL" is explicit: a CHECK whose result is NULL passes.
ALTER TABLE "public"."ServiceBundle"
ADD CONSTRAINT "ServiceBundle_values_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 80
    AND ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") BETWEEN 1 AND 500))
    AND "serviceIds" IS NOT NULL
    AND "public"."service_bundle_services_valid"("serviceIds")
);

-- The group keeps the bundle's name at the opening.
ALTER TABLE "public"."RequestGroup"
ADD CONSTRAINT "RequestGroup_name_check"
CHECK (char_length("bundleNameSnapshot") BETWEEN 1 AND 80);
