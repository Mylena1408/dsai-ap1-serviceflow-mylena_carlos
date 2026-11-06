import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { ArticleRecord, ArticleStore, ArticleTransaction } from "../application/articles";

// Persistence of the knowledge base (SPEC 2026-11-06-base-conhecimento, 5). A repeated title in a
// service violates the unique index (P2002), which becomes a conflict.

const policy = { translate: ["P2002", "P2025", "P2034"] as const, fallbackMessage: "Knowledge article change failed." };

const select = {
  id: true,
  serviceId: true,
  title: true,
  body: true,
  isPublished: true,
  position: true,
  updatedAt: true,
  updatedBy: { select: { name: true } },
} as const;

type Row = Omit<ArticleRecord, "updatedByName"> & { updatedBy: { name: string } };

function record({ updatedBy, ...row }: Row): ArticleRecord {
  return { ...row, updatedByName: updatedBy.name };
}

async function now(client: Prisma.TransactionClient): Promise<Date> {
  const [{ value }] = await client.$queryRaw<Array<{ value: Date }>>`SELECT now() AS "value"`;
  return value;
}

function transactionOf(client: Prisma.TransactionClient): ArticleTransaction {
  return {
    ...createPrismaAuditScope(client),
    async serviceSector(serviceId) {
      return (await client.service.findUnique({ where: { id: serviceId }, select: { sectorId: true } }))?.sectorId ?? null;
    },
    async find(articleId) {
      const row = await client.knowledgeArticle.findUnique({ where: { id: articleId }, select });
      return row && record(row);
    },
    async articleSector(articleId) {
      return (await client.knowledgeArticle.findUnique({ where: { id: articleId }, select: { service: { select: { sectorId: true } } } }))?.service.sectorId ?? null;
    },
    async create(input) {
      const at = await now(client);
      return client.knowledgeArticle.create({
        data: {
          serviceId: input.serviceId,
          title: input.title,
          body: input.body,
          position: input.position,
          createdById: input.actorId,
          updatedById: input.actorId,
          createdAt: at,
          updatedAt: at,
        },
        select: { id: true },
      });
    },
    async update(articleId, { actorId, ...data }) {
      const at = await now(client);
      return client.knowledgeArticle.update({ where: { id: articleId }, data: { ...data, updatedById: actorId, updatedAt: at }, select: { id: true } });
    },
    async remove(articleId) {
      await client.knowledgeArticle.delete({ where: { id: articleId } });
    },
  };
}

export function createPrismaArticleStore(database: PrismaClient): ArticleStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), policy);
    },
    async listForEditor(sectorId) {
      const services = await database.service.findMany({
        where: sectorId === null ? {} : { sectorId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, sectorId: true, isActive: true, knowledgeArticles: { select } },
      });
      return services.map(({ knowledgeArticles, ...service }) => ({ ...service, articles: knowledgeArticles.map(record) }));
    },
    async listPublished(serviceId) {
      // Only services the catalog shows: the service, its category and its sector are active.
      const rows = await database.knowledgeArticle.findMany({
        where: { serviceId, isPublished: true, service: { isActive: true, category: { isActive: true }, sector: { isActive: true } } },
        select,
      });
      return rows.map(record);
    },
  };
}
