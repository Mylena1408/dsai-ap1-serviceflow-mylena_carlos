-- SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1 and 7.4 (decision H16): each person's saved searches of
-- the queue and of "Minhas solicitações". Additive only: a new enum and a new table.

-- CreateEnum
CREATE TYPE "public"."SavedViewList" AS ENUM ('QUEUE', 'MY_REQUESTS');

-- CreateTable
CREATE TABLE "public"."SavedView" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "list" "public"."SavedViewList" NOT NULL,
    "name" CITEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the name is unique per person and list, ignoring case (citext).
CREATE UNIQUE INDEX "SavedView_userId_list_name_key" ON "public"."SavedView"("userId", "list", "name");

-- AddForeignKey
ALTER TABLE "public"."SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The name has 1 to 40 characters without spaces at the ends; the criteria (a query string) up to 1,000.
-- Both columns are NOT NULL, so the CHECK never sees a NULL.
ALTER TABLE "public"."SavedView"
ADD CONSTRAINT "SavedView_values_check"
CHECK (
    "name" = btrim("name")
    AND char_length("name") BETWEEN 1 AND 40
    AND char_length("criteria") <= 1000
);
