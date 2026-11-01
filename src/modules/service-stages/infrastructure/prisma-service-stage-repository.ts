import type { Prisma, PrismaClient, ServiceStage } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { ServiceStageRecord } from "../domain/service-stage";
import type { ServiceStageRepository, ServiceStageTransaction, ServiceStageTransactionRunner } from "../application/ports";

// Compile-time check that the Prisma row matches the domain type.
const toDomain = (row: ServiceStage): ServiceStageRecord => row;

export function createPrismaServiceStageRepository(database: PrismaClient): ServiceStageRepository {
  return {
    async listAll() {
      const rows = await database.serviceStage.findMany({
        orderBy: [{ serviceId: "asc" }, { isActive: "desc" }, { position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

function createPrismaServiceStageTransaction(transaction: Prisma.TransactionClient): ServiceStageTransaction {
  return {
    async serviceExists(serviceId) {
      const service = await transaction.service.findUnique({ where: { id: serviceId }, select: { id: true } });
      return service !== null;
    },
    listForService(serviceId) {
      return transaction.serviceStage.findMany({
        where: { serviceId },
        select: { id: true, position: true, name: true, isActive: true },
      });
    },
    async find(stageId) {
      const row = await transaction.serviceStage.findUnique({ where: { id: stageId } });
      return row && toDomain(row);
    },
    async create(data) {
      return toDomain(await transaction.serviceStage.create({ data }));
    },
    async update(stageId, data) {
      return toDomain(await transaction.serviceStage.update({ where: { id: stageId }, data }));
    },
  };
}

export function createPrismaServiceStageTransactionRunner(database: PrismaClient): ServiceStageTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(createPrismaServiceStageTransaction(transaction)), {
        translate: ["P2002", "P2025", "P2003"],
        fallbackMessage: "Stage configuration operation failed.",
      });
    },
  };
}
