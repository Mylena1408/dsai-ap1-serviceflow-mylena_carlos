import { Prisma, type PrismaClient } from "@prisma/client";
import {
  translatePrismaError,
  type TranslatedPrismaErrorCode,
} from "@/server/db/prisma-errors";
import type { RequestWithHistory } from "../domain/request";
import type {
  RequestQueryRepository,
  RequestTransaction,
  RequestTransactionRunner,
} from "../application/ports";

const requestWithHistory = {
  events: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: {
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  },
  service: {
    select: { id: true, isActive: true },
  },
} satisfies Prisma.RequestInclude;

// Compile-time check that the Prisma row matches the domain type exactly.
type RequestWithHistoryRow = Prisma.RequestGetPayload<{
  include: typeof requestWithHistory;
}>;
const toDomain = (row: RequestWithHistoryRow): RequestWithHistory => row;

export function createPrismaRequestQueryRepository(
  database: PrismaClient,
): RequestQueryRepository {
  return {
    async listByRequester(requesterId) {
      const rows = await database.request.findMany({
        where: { requesterId },
        include: requestWithHistory,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toDomain);
    },
    async findForRequester(requestId, requesterId) {
      const row = await database.request.findFirst({
        where: { id: requestId, requesterId },
        include: requestWithHistory,
      });
      return row && toDomain(row);
    },
    async listBySector(sectorId) {
      const rows = await database.request.findMany({
        where: { sectorId },
        include: requestWithHistory,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },
    async findInSector(requestId, sectorId) {
      const row = await database.request.findFirst({
        where: { id: requestId, sectorId },
        include: requestWithHistory,
      });
      return row && toDomain(row);
    },
  };
}

function createPrismaRequestTransaction(
  transaction: Prisma.TransactionClient,
): RequestTransaction {
  return {
    findActor(actorId) {
      return transaction.user.findUnique({
        where: { id: actorId },
        select: { id: true, role: true, sectorId: true, isActive: true },
      });
    },
    findServiceForRequest(serviceId) {
      return transaction.service.findUnique({
        where: { id: serviceId },
        include: {
          category: { select: { id: true, name: true, isActive: true } },
          sector: { select: { id: true, name: true, isActive: true } },
        },
      });
    },
    insertRequest(data) {
      return transaction.request.create({ data, select: { id: true } });
    },
    findRequestState(requestId) {
      return transaction.request.findUnique({
        where: { id: requestId },
        select: { status: true, sectorId: true },
      });
    },
    async updateStatusIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          sectorId: update.sectorId,
          status: update.expectedStatus,
        },
        data: {
          status: update.toStatus,
          updatedAt: update.updatedAt,
          ...(update.completedAt ? { completedAt: update.completedAt } : {}),
        },
      });
      return result.count;
    },
    async insertStatusEvent(event) {
      await transaction.requestStatusEvent.create({ data: event });
    },
    async getWithHistory(requestId) {
      return toDomain(
        await transaction.request.findUniqueOrThrow({
          where: { id: requestId },
          include: requestWithHistory,
        }),
      );
    },
  };
}

/**
 * Serializable transaction runner. Translates only the Prisma error codes listed by
 * the caller and wraps non-Error throwables with `fallbackMessage`, as before SF-038.
 */
export function createPrismaRequestTransactionRunner(
  database: PrismaClient,
  options: { translate: readonly TranslatedPrismaErrorCode[]; fallbackMessage: string },
): RequestTransactionRunner {
  return {
    async run(work) {
      try {
        return await database.$transaction(
          (transaction) => work(createPrismaRequestTransaction(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const translated = translatePrismaError(error, options.translate);

        if (translated) {
          throw translated;
        }

        throw error instanceof Error ? error : new Error(options.fallbackMessage);
      }
    },
  };
}
