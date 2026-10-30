import type { Prisma, PrismaClient, Sector } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { SectorRecord } from "../domain/sector";
import type {
  SectorRepository,
  SectorTransaction,
  SectorTransactionRunner,
} from "../application/ports";

// Compile-time check that the Prisma row matches the domain type.
const toDomain = (row: Sector): SectorRecord => row;

export function createPrismaSectorRepository(database: PrismaClient): SectorRepository {
  return {
    async listByName() {
      const rows = await database.sector.findMany({ orderBy: { name: "asc" } });
      return rows.map(toDomain);
    },
  };
}

function createPrismaSectorTransaction(transaction: Prisma.TransactionClient): SectorTransaction {
  return {
    async exists(sectorId) {
      const current = await transaction.sector.findUnique({
        where: { id: sectorId },
        select: { id: true },
      });
      return current !== null;
    },
    async create(name) {
      return toDomain(await transaction.sector.create({ data: { name } }));
    },
    async update(sectorId, data) {
      return toDomain(await transaction.sector.update({ where: { id: sectorId }, data }));
    },
    async findDeactivationDependencies(sectorId) {
      const [activeServices, activeAttendants, pendingRequests] = await Promise.all([
        transaction.service.count({
          where: { sectorId, isActive: true },
        }),
        transaction.user.count({
          where: { sectorId, role: "ATTENDANT", isActive: true },
        }),
        transaction.request.count({
          where: {
            sectorId,
            status: { in: ["OPEN", "IN_PROGRESS"] },
          },
        }),
      ]);

      return {
        hasActiveService: activeServices > 0,
        hasPendingRequest: pendingRequests > 0,
        hasActiveAttendant: activeAttendants > 0,
      };
    },
  };
}

export function createPrismaSectorTransactionRunner(
  database: PrismaClient,
): SectorTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaSectorTransaction(transaction)),
        { translate: ["P2002", "P2025", "P2003"], fallbackMessage: "Sector operation failed." },
      );
    },
  };
}
