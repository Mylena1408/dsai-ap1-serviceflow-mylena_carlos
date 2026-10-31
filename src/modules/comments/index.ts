import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/comment-use-cases";
import type { CommentRecord } from "./application/ports";
import {
  createPrismaCommentRepository,
  createPrismaCommentTransactionRunner,
} from "./infrastructure/prisma-comment-repository";

export { MAX_COMMENT_LENGTH } from "./domain/comment-policy";
export type { CommentRecord } from "./application/ports";

export async function addComment(input: unknown, database: PrismaClient = prisma): Promise<CommentRecord> {
  return useCases.addComment(input, createPrismaCommentTransactionRunner(database));
}

export async function listComments(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<CommentRecord[]> {
  return useCases.listComments(requestId, createPrismaCommentRepository(database));
}

export async function countComments(
  requestIds: string[],
  database: PrismaClient = prisma,
): Promise<Map<string, number>> {
  return useCases.countComments(requestIds, createPrismaCommentRepository(database));
}
