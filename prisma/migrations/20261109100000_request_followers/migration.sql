-- SPEC 2026-11-08-atendimento-dia-a-dia, 6.3, 6.4 and 13.3 item 2 (decisions I12 to I14 and J7): who follows a
-- request, the history of following, and whether commenting makes an attendant follow.
-- Additive only: a new enum and three tables, with indexes and keys. The limit of 10 colleagues per request and who
-- may be a follower are checked by the use cases, in serializable transactions.

-- CreateEnum
CREATE TYPE "public"."RequestFollowerAction" AS ENUM ('ADDED', 'REMOVED');

-- CreateTable
CREATE TABLE "public"."RequestFollower" (
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestFollower_pkey" PRIMARY KEY ("requestId","userId")
);

-- CreateTable
CREATE TABLE "public"."RequestFollowerEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" "public"."RequestFollowerAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RequestFollowerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FollowPreference" (
    "userId" UUID NOT NULL,
    "autoFollowOnComment" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FollowPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "RequestFollower_userId_idx" ON "public"."RequestFollower"("userId");

-- CreateIndex
CREATE INDEX "RequestFollowerEvent_requestId_occurredAt_idx" ON "public"."RequestFollowerEvent"("requestId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."RequestFollower" ADD CONSTRAINT "RequestFollower_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFollower" ADD CONSTRAINT "RequestFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFollower" ADD CONSTRAINT "RequestFollower_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFollowerEvent" ADD CONSTRAINT "RequestFollowerEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "public"."Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFollowerEvent" ADD CONSTRAINT "RequestFollowerEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestFollowerEvent" ADD CONSTRAINT "RequestFollowerEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FollowPreference" ADD CONSTRAINT "FollowPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

