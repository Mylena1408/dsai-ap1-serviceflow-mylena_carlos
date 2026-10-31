import { Prisma, type PrismaClient } from "@prisma/client";
import {
  runSerializableTransaction,
  type PersistenceErrorPolicy,
} from "@/server/db/serializable-transaction";
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
  assignee: {
    select: { id: true, name: true, role: true, isActive: true, sectorId: true },
  },
} satisfies Prisma.RequestInclude;

const lifecycleUser = { id: true, role: true, isActive: true, sectorId: true } as const;

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
    listSectorAttendants(sectorId) {
      return database.user.findMany({
        where: { sectorId, role: "ATTENDANT", isActive: true },
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
  };
}

function createPrismaRequestTransaction(
  transaction: Prisma.TransactionClient,
): RequestTransaction {
  return {
    async currentTime() {
      // now() is the transaction start time: the same value for every statement in it.
      const [row] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return row.now;
    },
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
    listActiveRequirements(serviceId) {
      return transaction.serviceDocumentRequirement.findMany({
        where: { serviceId, isActive: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, name: true, isRequired: true, acceptedFormats: true },
      });
    },
    insertRequest({ openedAt, ...data }) {
      return transaction.request.create({
        data: { ...data, createdAt: openedAt, updatedAt: openedAt },
        select: { id: true },
      });
    },
    async insertAttachments(attachments) {
      await transaction.requestAttachment.createMany({ data: attachments });
    },
    async updateStatusIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          sectorId: update.sectorId,
          status: update.expectedStatus,
          ...(update.expectedAssigneeId !== undefined
            ? { assigneeId: update.expectedAssigneeId }
            : {}),
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
    findLifecycleState(requestId) {
      return transaction.request.findUnique({
        where: { id: requestId },
        select: {
          requesterId: true,
          sectorId: true,
          status: true,
          completedAt: true,
          assignee: { select: lifecycleUser },
        },
      });
    },
    findUserForAssignment(userId) {
      return transaction.user.findUnique({ where: { id: userId }, select: lifecycleUser });
    },
    async updateAssigneeIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          status: update.expectedStatus,
          assigneeId: update.expectedAssigneeId,
        },
        data: { assigneeId: update.assigneeId, updatedAt: update.updatedAt },
      });
      return result.count;
    },
    async insertAssignmentEvent(event) {
      await transaction.requestAssignmentEvent.create({ data: event });
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

/** Serializable transaction runner that translates errors according to `policy`. */
export function createPrismaRequestTransactionRunner(
  database: PrismaClient,
  policy: PersistenceErrorPolicy,
): RequestTransactionRunner {
  return {
    run(work) {
      return runSerializableTransaction(
        database,
        (transaction) => work(createPrismaRequestTransaction(transaction)),
        policy,
      );
    },
  };
}
