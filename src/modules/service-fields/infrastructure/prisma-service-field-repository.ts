import type { Prisma, PrismaClient, ServiceField } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { ServiceFieldRecord } from "../domain/service-field";
import type { ServiceFieldRepository, ServiceFieldTransaction, ServiceFieldTransactionRunner } from "../application/ports";

// Compile-time check that the Prisma row matches the domain type.
const toDomain = (row: ServiceField): ServiceFieldRecord => row;

export function createPrismaServiceFieldRepository(database: PrismaClient): ServiceFieldRepository {
  return {
    async listAll() {
      const rows = await database.serviceField.findMany({
        orderBy: [{ serviceId: "asc" }, { isActive: "desc" }, { position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
    async listForSector(sectorId) {
      const rows = await database.serviceField.findMany({
        where: { service: { sectorId } },
        orderBy: [{ serviceId: "asc" }, { isActive: "desc" }, { position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
    async listActiveForService(serviceId) {
      const rows = await database.serviceField.findMany({
        where: { serviceId, isActive: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

function createPrismaServiceFieldTransaction(transaction: Prisma.TransactionClient): ServiceFieldTransaction {
  return {
    async findServiceSector(serviceId) {
      const service = await transaction.service.findUnique({ where: { id: serviceId }, select: { sectorId: true } });
      return service?.sectorId ?? null;
    },
    listForService(serviceId) {
      return transaction.serviceField.findMany({
        where: { serviceId },
        select: { id: true, position: true, label: true, isActive: true },
      });
    },
    async find(fieldId) {
      const row = await transaction.serviceField.findUnique({ where: { id: fieldId } });
      return row && toDomain(row);
    },
    async create(data) {
      return toDomain(await transaction.serviceField.create({ data }));
    },
    async update(fieldId, data) {
      return toDomain(await transaction.serviceField.update({ where: { id: fieldId }, data }));
    },
  };
}

export function createPrismaServiceFieldTransactionRunner(database: PrismaClient): ServiceFieldTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(createPrismaServiceFieldTransaction(transaction)), {
        translate: ["P2002", "P2025", "P2003"],
        fallbackMessage: "Custom field operation failed.",
      });
    },
  };
}
