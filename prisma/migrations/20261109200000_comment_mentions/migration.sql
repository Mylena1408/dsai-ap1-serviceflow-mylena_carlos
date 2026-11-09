-- SPEC 2026-11-08-atendimento-dia-a-dia, 7.3, 7.4 and 13.4 (decisions I15, I16 and J8): the colleagues mentioned in
-- internal notes, kept by id, and when each person saw the mention. Additive only: one table with its keys.
-- Who may be mentioned (active attendants of the request's sector, up to 5) is checked by the use case.

-- CreateTable
CREATE TABLE "public"."CommentMention" (
    "commentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "seenAt" TIMESTAMPTZ,

    CONSTRAINT "CommentMention_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateIndex
CREATE INDEX "CommentMention_userId_createdAt_idx" ON "public"."CommentMention"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."CommentMention" ADD CONSTRAINT "CommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "public"."RequestComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommentMention" ADD CONSTRAINT "CommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A mention is seen only after it exists.
ALTER TABLE "public"."CommentMention"
ADD CONSTRAINT "CommentMention_seen_check"
CHECK ("seenAt" IS NULL OR "seenAt" >= "createdAt");
