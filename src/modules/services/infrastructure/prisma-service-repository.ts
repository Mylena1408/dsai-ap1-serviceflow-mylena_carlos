import type { Prisma, PrismaClient, Service } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { PublishedService, ServiceRecord } from "../domain/service";
import type {
  PublishedCatalogRepository,
  ServiceRepository,
  ServiceTransaction,
  ServiceTransactionRunner,
} from "../application/ports";

const publishedServiceInclude = {
  category: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
} satisfies Prisma.ServiceInclude;

const publishedWhere = {
  isActive: true,
  category: { isActive: true },
  sector: { isActive: true },
} satisfies Prisma.ServiceWhereInput;

// Compile-time checks that the Prisma rows match the domain types.
const toDomain = (row: Service): ServiceRecord => row;
const toPublished = (
  row: Prisma.ServiceGetPayload<{ include: typeof publishedServiceInclude }>,
): PublishedService => row;

export function createPrismaServiceRepository(database: PrismaClient): ServiceRepository {
  return {
    async listByName() {
      // The administration screen also reads the related category and sector.
      const rows = await database.service.findMany({
        include: {
          category: true,
          sector: true,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

export function createPrismaPublishedCatalogRepository(
  database: PrismaClient,
): PublishedCatalogRepository {
  return {
    async listPublished() {
      const rows = await database.service.findMany({
        where: publishedWhere,
        include: publishedServiceInclude,
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }, { id: "asc" }],
      });
      return rows.map(toPublished);
    },
    async findPublished(serviceId) {
      const row = await database.service.findFirst({
        where: { id: serviceId, ...publishedWhere },
        include: publishedServiceInclude,
      });
      return row && toPublished(row);
    },
  };
}

function createPrismaServiceTransaction(transaction: Prisma.TransactionClient): ServiceTransaction {
  return {
    findState(serviceId) {
      return transaction.service.findUnique({
        where: { id: serviceId },
        select: { id: true, isActive: true, categoryId: true, sectorId: true },
      });
    },
    async loadRelationships(categoryId, sectorId) {
      const [category, sector] = await Promise.all([
        transaction.category.findUnique({
          where: { id: categoryId },
          select: { isActive: true },
        }),
        transaction.sector.findUnique({
          where: { id: sectorId },
          select: { isActive: true },
        }),
      ]);

      return {
        categoryExists: category !== null,
        categoryActive: category?.isActive ?? false,
        sectorExists: sector !== null,
        sectorActive: sector?.isActive ?? false,
      };
    },
    async create(data) {
      return toDomain(await transaction.service.create({ data }));
    },
    async update(serviceId, data) {
      return toDomain(await transaction.service.update({ where: { id: serviceId }, data }));
    },
  };
}

export function createPrismaServiceTransactionRunner(
  database: PrismaClient,
): ServiceTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaServiceTransaction(transaction)),
        { translate: ["P2002", "P2025", "P2003"], fallbackMessage: "Service operation failed." },
      );
    },
  };
}
