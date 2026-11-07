import type { Prisma, PrismaClient, ServiceField } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import { createPrismaAuditScope } from "@/modules/audit";
import type { ServiceFieldRecord } from "../domain/service-field";
import { decimalLimitText } from "./decimal-limit";
import type { ServiceFieldRepository, ServiceFieldTransaction, ServiceFieldTransactionRunner } from "../application/ports";

// Decimal limits come from the database as Prisma decimals and become text with the field's places
// (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1); the rest of the row is the domain type.
const toDomain = ({ minDecimal, maxDecimal, ...row }: ServiceField): ServiceFieldRecord => ({
  ...row,
  minDecimal: decimalLimitText(minDecimal, row.decimalPlaces),
  maxDecimal: decimalLimitText(maxDecimal, row.decimalPlaces),
});

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
    ...createPrismaAuditScope(transaction),
    async findServiceSector(serviceId) {
      const service = await transaction.service.findUnique({ where: { id: serviceId }, select: { sectorId: true } });
      return service?.sectorId ?? null;
    },
    listForService(serviceId) {
      return transaction.serviceField.findMany({
        where: { serviceId },
        select: {
          id: true,
          position: true,
          label: true,
          isActive: true,
          type: true,
          options: true,
          audience: true,
          conditionFieldId: true,
          conditionValue: true,
        },
      });
    },
    async findApprovalConditionValue(fieldId) {
      const service = await transaction.service.findFirst({
        where: { approvalConditionFieldId: fieldId },
        select: { approvalConditionValue: true },
      });
      return service?.approvalConditionValue ?? null;
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
