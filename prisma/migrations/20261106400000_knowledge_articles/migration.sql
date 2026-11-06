-- SPEC 2026-11-06-base-conhecimento, seção 5. Additive only: a new value of the audit entity type,
-- a new table with its indexes, foreign keys and CHECKs. Nothing that exists changes.

-- AlterEnum
ALTER TYPE "public"."AuditEntityType" ADD VALUE 'KNOWLEDGE_ARTICLE';

-- CreateTable
CREATE TABLE "public"."KnowledgeArticle" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "title" CITEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 999,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_serviceId_title_key" ON "public"."KnowledgeArticle"("serviceId", "title");

-- AddForeignKey
ALTER TABLE "public"."KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Title: 1 to 160 characters, no spaces at the ends; body: 1 to 20,000; position 0 to 999 (4.1).
ALTER TABLE "public"."KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_title_check"
  CHECK ("title" IS NOT NULL AND char_length("title") BETWEEN 1 AND 160 AND "title" = btrim("title"));
ALTER TABLE "public"."KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_body_check"
  CHECK ("body" IS NOT NULL AND char_length("body") BETWEEN 1 AND 20000);
ALTER TABLE "public"."KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_position_check"
  CHECK ("position" IS NOT NULL AND "position" BETWEEN 0 AND 999);
