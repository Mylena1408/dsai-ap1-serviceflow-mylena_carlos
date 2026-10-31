import type { Prisma, PrismaClient, ServiceDocumentRequirement } from "@prisma/client";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { DocumentRequirementRecord } from "../domain/document-requirement";
import type {
  DocumentRequirementRepository,
  DocumentRequirementTransaction,
  DocumentRequirementTransactionRunner,
} from "../application/ports";

// Compile-time check that the Prisma row matches the domain type.
const toDomain = (row: ServiceDocumentRequirement): DocumentRequirementRecord => row;

export function createPrismaDocumentRequirementRepository(
  database: PrismaClient,
): DocumentRequirementRepository {
  return {
    async listAll() {
      const rows = await database.serviceDocumentRequirement.findMany({
        orderBy: [{ serviceId: "asc" }, { isActive: "desc" }, { position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
    async listActiveForService(serviceId) {
      const rows = await database.serviceDocumentRequirement.findMany({
        where: { serviceId, isActive: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
  };
}

function createPrismaDocumentRequirementTransaction(
  transaction: Prisma.TransactionClient,
): DocumentRequirementTransaction {
  return {
    async serviceExists(serviceId) {
      const service = await transaction.service.findUnique({
        where: { id: serviceId },
        select: { id: true },
      });
      return service !== null;
    },
    listForService(serviceId) {
      return transaction.serviceDocumentRequirement.findMany({
        where: { serviceId },
        select: { id: true, position: true, isActive: true },
      });
    },
    listActiveForService(serviceId) {
      return transaction.serviceDocumentRequirement.findMany({
        where: { serviceId, isActive: true },
        select: { id: true, position: true },
      });
    },
    async find(requirementId) {
      const row = await transaction.serviceDocumentRequirement.findUnique({
        where: { id: requirementId },
      });
      return row && toDomain(row);
    },
    async create(data) {
      return toDomain(await transaction.serviceDocumentRequirement.create({ data }));
    },
    async update(requirementId, data) {
      return toDomain(
        await transaction.serviceDocumentRequirement.update({ where: { id: requirementId }, data }),
      );
    },
  };
}

export function createPrismaDocumentRequirementTransactionRunner(
  database: PrismaClient,
): DocumentRequirementTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaDocumentRequirementTransaction(transaction)),
        {
          translate: ["P2002", "P2025", "P2003"],
          fallbackMessage: "Document requirement operation failed.",
        },
      );
    },
  };
}
