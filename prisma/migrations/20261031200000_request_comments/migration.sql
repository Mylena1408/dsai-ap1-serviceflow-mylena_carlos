-- SPEC 2026-10-31 (comentários), seção 6. Additive only.

-- CreateTable
CREATE TABLE "public"."RequestComment" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestComment_requestId_createdAt_idx" ON "public"."RequestComment"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."RequestComment" ADD CONSTRAINT "RequestComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestComment" ADD CONSTRAINT "RequestComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Plain text, 1 to 5,000 characters, stored without surrounding spaces (SPEC seção 5.3).
ALTER TABLE "public"."RequestComment"
ADD CONSTRAINT "RequestComment_body_check"
CHECK ("body" = btrim("body") AND char_length("body") BETWEEN 1 AND 5000);
