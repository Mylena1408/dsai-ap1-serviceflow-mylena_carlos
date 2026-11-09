import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getApplicationDocumentStorage, type DocumentStorage } from "@/server/storage";
import * as useCases from "./application/comment-use-cases";
import * as myMentions from "./application/my-mentions";
import { createPrismaMyMentionsReader } from "./infrastructure/prisma-my-mentions";
import type { CommentRecord } from "./application/ports";
import {
  createPrismaCommentRepository,
  createPrismaCommentTransactionRunner,
} from "./infrastructure/prisma-comment-repository";

export { MAX_COMMENT_LENGTH } from "./domain/comment-policy";
// SPEC 2026-11-08-atendimento-dia-a-dia, part E.
export { MAX_MENTIONS, mentionLine, planMentions } from "./domain/mentions";
export type { CommentFileSummary, CommentRecord } from "./application/ports";
export type { CommentFileDownload } from "./application/comment-use-cases";

export async function addComment(
  input: unknown,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<CommentRecord> {
  return useCases.addComment(input, createPrismaCommentTransactionRunner(database), storage);
}

/** SPEC 2026-11-03-anexos-comentarios-documentos, 5.2. */
export async function getCommentFileDownload(
  input: unknown,
  database: PrismaClient = prisma,
  storage: Pick<DocumentStorage, "get"> = getApplicationDocumentStorage(),
): Promise<useCases.CommentFileDownload> {
  return useCases.getCommentFileDownload(input, createPrismaCommentRepository(database), storage);
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

/** SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 item 1: whom the attendant may mention in a note on this request. */
export function listMentionableColleagues(requestId: unknown, database: PrismaClient = prisma) {
  return useCases.listMentionableColleagues(requestId, createPrismaCommentRepository(database));
}

// "Minhas menções" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1).
export type { MyMention } from "./application/my-mentions";

export function listMyMentions(database: PrismaClient = prisma) {
  return myMentions.listMyMentions(createPrismaMyMentionsReader(database));
}

export function countUnseenMentions(database: PrismaClient = prisma) {
  return myMentions.countUnseenMentions(createPrismaMyMentionsReader(database));
}

export function openMention(commentId: unknown, database: PrismaClient = prisma) {
  return myMentions.openMention(commentId, createPrismaMyMentionsReader(database));
}
