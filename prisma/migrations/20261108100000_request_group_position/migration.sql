-- SPEC 2026-11-07-operacao-e-automacao, seção 3.3 (regra 4) (SF-179). Additive: one nullable column.
-- The requests of a bundle share the opening instant, so the bundle's order needs its own column.

-- AlterTable
ALTER TABLE "public"."Request" ADD COLUMN     "groupPosition" INTEGER;

-- Requests of groups opened before this column (only possible where the bundles migration ran first)
-- get a position by their creation order, so the rule below holds for every row.
UPDATE "public"."Request" AS r
SET "groupPosition" = ordered."position"
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "groupId" ORDER BY "createdAt", "id") AS "position"
    FROM "public"."Request"
    WHERE "groupId" IS NOT NULL
) AS ordered
WHERE r."id" = ordered."id";

-- A position exists exactly with a group, from 1 to 5, and once per group.
ALTER TABLE "public"."Request"
ADD CONSTRAINT "Request_groupPosition_check"
CHECK (("groupId" IS NULL) = ("groupPosition" IS NULL) AND ("groupPosition" IS NULL OR "groupPosition" BETWEEN 1 AND 5));

CREATE UNIQUE INDEX "Request_group_position_key" ON "public"."Request" ("groupId", "groupPosition") WHERE "groupId" IS NOT NULL;
