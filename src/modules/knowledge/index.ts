import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/articles";
import { createPrismaArticleStore } from "./infrastructure/prisma-articles";

// Knowledge base per service (SPEC 2026-11-06-base-conhecimento).
export {
  MAX_ARTICLE_BODY_LENGTH,
  MAX_ARTICLE_POSITION,
  MAX_ARTICLE_TITLE_LENGTH,
  articleParagraphs,
} from "./domain/article";
export type { ArticleRecord, EditorService } from "./application/articles";

const store = (database: PrismaClient) => createPrismaArticleStore(database);

export function listArticlesForEditor(database: PrismaClient = prisma) {
  return useCases.listArticlesForEditor(store(database));
}

export function createArticle(serviceId: unknown, input: unknown, database: PrismaClient = prisma) {
  return useCases.createArticle(serviceId, input, store(database));
}

export function updateArticle(articleId: unknown, input: unknown, database: PrismaClient = prisma) {
  return useCases.updateArticle(articleId, input, store(database));
}

export function setArticlePublished(articleId: unknown, published: boolean, database: PrismaClient = prisma) {
  return useCases.setArticlePublished(articleId, published, store(database));
}

export function deleteArticle(articleId: unknown, database: PrismaClient = prisma) {
  return useCases.deleteArticle(articleId, store(database));
}

export function listPublishedArticles(serviceId: unknown, database: PrismaClient = prisma) {
  return useCases.listPublishedArticles(serviceId, store(database));
}

// The rules of this configuration screen, also used by the import's preview (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4).
export { articleInputSchema } from "./domain/article";
