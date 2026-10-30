import type { Prisma, PrismaClient } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { ManagedUser } from "../domain/user";
import type {
  UserRepository,
  UserTransaction,
  UserTransactionRunner,
} from "../application/ports";

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  sectorId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// Compile-time check that the selected columns match the domain type.
const toDomain = (row: Prisma.UserGetPayload<{ select: typeof publicUserSelect }>): ManagedUser =>
  row;

export function createPrismaUserRepository(database: PrismaClient): UserRepository {
  return {
    async listByName() {
      const rows = await database.user.findMany({
        select: publicUserSelect,
        orderBy: [{ name: "asc" }, { email: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

function createPrismaUserTransaction(transaction: Prisma.TransactionClient): UserTransaction {
  return {
    findState(userId) {
      return transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, sectorId: true, isActive: true },
      });
    },
    findSectorActivity(sectorId) {
      return transaction.sector.findUnique({
        where: { id: sectorId },
        select: { isActive: true },
      });
    },
    countActiveAdministrators() {
      return transaction.user.count({ where: { role: "ADMIN", isActive: true } });
    },
    countPendingRequestsInSector(sectorId) {
      return transaction.request.count({
        where: { sectorId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      });
    },
    countOtherActiveAttendants(sectorId, excludedUserId) {
      return transaction.user.count({
        where: {
          id: { not: excludedUserId },
          role: "ATTENDANT",
          sectorId,
          isActive: true,
        },
      });
    },
    async create(user) {
      return toDomain(await transaction.user.create({ data: user, select: publicUserSelect }));
    },
    async update(userId, changes) {
      return toDomain(
        await transaction.user.update({
          where: { id: userId },
          data: changes,
          select: publicUserSelect,
        }),
      );
    },
  };
}

export function createPrismaUserTransactionRunner(database: PrismaClient): UserTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaUserTransaction(transaction)),
        { translate: ["P2002", "P2025", "P2003"], fallbackMessage: "User operation failed." },
      );
    },
  };
}
