import type { Category, Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { CategoryRecord } from "../domain/category";
import type {
  CategoryRepository,
  CategoryTransaction,
  CategoryTransactionRunner,
} from "../application/ports";

// Compile-time check that the Prisma row matches the domain type.
const toDomain = (row: Category): CategoryRecord => row;

export function createPrismaCategoryRepository(database: PrismaClient): CategoryRepository {
  return {
    async listByName() {
      const rows = await database.category.findMany({ orderBy: { name: "asc" } });
      return rows.map(toDomain);
    },
  };
}

function createPrismaCategoryTransaction(
  transaction: Prisma.TransactionClient,
): CategoryTransaction {
  return {
    async exists(categoryId) {
      const current = await transaction.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      return current !== null;
    },
    async create(name) {
      return toDomain(await transaction.category.create({ data: { name } }));
    },
    async update(categoryId, data) {
      return toDomain(await transaction.category.update({ where: { id: categoryId }, data }));
    },
    async hasActiveService(categoryId) {
      const activeServices = await transaction.service.count({
        where: { categoryId, isActive: true },
      });
      return activeServices > 0;
    },
  };
}

export function createPrismaCategoryTransactionRunner(
  database: PrismaClient,
): CategoryTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaCategoryTransaction(transaction)),
        { translate: ["P2002", "P2025", "P2003"], fallbackMessage: "Category operation failed." },
      );
    },
  };
}
