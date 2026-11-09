import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as followers from "./application/followers";
import { createPrismaFollowerReader, createPrismaFollowerStore } from "./infrastructure/prisma-followers";

// Followers of a request (SPEC 2026-11-08-atendimento-dia-a-dia, part D): the rules (SF-211), adding, removing and the
// colleague's reading (SF-212).
export {
  MAX_COLLEAGUE_FOLLOWERS,
  assertCanRemoveFollower,
  autoFollowsOnComment,
  followerEventTitle,
  planAddFollower,
  readsAsFollower,
} from "./domain/follower";
export type { CurrentFollower, FollowKind, FollowedRequest, FollowerPerson, FollowerRole } from "./domain/follower";
export type { FollowerEventView, FollowerReading, FollowerView, RequestFollowersView } from "./application/followers";

export function addFollower(input: unknown, database: PrismaClient = prisma) {
  return followers.addFollower(input, createPrismaFollowerStore(database));
}

export function removeFollower(input: unknown, database: PrismaClient = prisma) {
  return followers.removeFollower(input, createPrismaFollowerStore(database));
}

export function getRequestFollowers(requestId: unknown, database: PrismaClient = prisma): Promise<followers.RequestFollowersView> {
  return followers.getRequestFollowers(requestId, createPrismaFollowerReader(database));
}

export function getFollowerReading(requestId: unknown, database: PrismaClient = prisma): Promise<followers.FollowerReading> {
  return followers.getFollowerReading(requestId, createPrismaFollowerReader(database));
}
