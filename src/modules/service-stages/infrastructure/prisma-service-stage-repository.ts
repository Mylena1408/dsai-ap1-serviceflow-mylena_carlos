import type { Prisma, PrismaClient, ServiceStage } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { createPrismaAuditScope } from "@/modules/audit";
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
    async listActiveAttendants(sectorId) {
      const rows = await database.user.findMany({
        where: { role: "ATTENDANT", isActive: true, sectorId: sectorId === null ? { not: null } : sectorId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, sectorId: true },
      });
      return rows.flatMap((row) => (row.sectorId ? [{ id: row.id, name: row.name, sectorId: row.sectorId }] : []));
    },
    async listForSector(sectorId) {
      const rows = await database.serviceStage.findMany({
        where: { service: { sectorId } },
        orderBy: [{ serviceId: "asc" }, { isActive: "desc" }, { position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

function createPrismaServiceStageTransaction(transaction: Prisma.TransactionClient): ServiceStageTransaction {
  return {
    ...createPrismaAuditScope(transaction),
    async findServiceSector(serviceId) {
      const service = await transaction.service.findUnique({ where: { id: serviceId }, select: { sectorId: true } });
      return service?.sectorId ?? null;
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
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1 and 5.3.3.
    findUser(userId) {
      return transaction.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, sectorId: true } });
    },
    findConditionField(fieldId, serviceId) {
      return transaction.serviceField.findFirst({
        where: { id: fieldId, serviceId },
        select: { id: true, type: true, options: true, audience: true, isActive: true, conditionFieldId: true },
      });
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
