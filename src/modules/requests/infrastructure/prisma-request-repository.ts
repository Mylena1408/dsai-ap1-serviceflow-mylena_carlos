import { Prisma, type PrismaClient } from "@prisma/client";
import {
  runSerializableTransaction,
  type PersistenceErrorPolicy,
} from "@/server/db/serializable-transaction";
import { recordOutboxEvent } from "@/modules/events";
import type { RequestStatus, RequestWithHistory } from "../domain/request";
import {
  escapeLikePattern,
  pageWindow,
  type SearchCriteria,
  type SearchOrder,
  type SlaFilter,
} from "../domain/search-criteria";
import type {
  RequestSearchScope,
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
  priorityEvents: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: { actor: { select: { id: true, name: true } } },
  },
  stageEvents: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: { actor: { select: { id: true, name: true } } },
  },
  assignmentEvents: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: {
      actor: { select: { id: true, name: true } },
      fromAssignee: { select: { id: true, name: true } },
      toAssignee: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.RequestInclude;

const lifecycleUser = { id: true, role: true, isActive: true, sectorId: true } as const;

// Compile-time check that the Prisma row matches the domain type exactly.
type RequestWithHistoryRow = Prisma.RequestGetPayload<{
  include: typeof requestWithHistory;
}>;
const toDomain = (row: RequestWithHistoryRow): RequestWithHistory => row;

/**
 * Prisma filter for one reader's list (SPEC 2026-10-31-busca-filtros-paginacao, section 5).
 * The scope always comes from the session.
 */
const ACTIVE_STATUSES: RequestStatus[] = ["OPEN", "IN_PROGRESS"];

/**
 * Filter by SLA situation, the same rules as `slaSituation` (SPEC 2026-11-01, section 5.4):
 * only open or in-progress requests have a running situation; at the due date itself the
 * request is still "due soon". `dueSoonAt` is kept by a database trigger.
 */
function slaWhere(filter: SlaFilter, now: Date): Prisma.RequestWhereInput {
  switch (filter) {
    case "on_time":
      return { status: { in: ACTIVE_STATUSES }, dueSoonAt: { gt: now } };
    case "due_soon":
      return { status: { in: ACTIVE_STATUSES }, dueSoonAt: { lte: now }, dueAt: { gte: now } };
    case "overdue":
      return { status: { in: ACTIVE_STATUSES }, dueAt: { lt: now } };
    case "none":
      return { OR: [{ dueAt: null }, { status: "CANCELLED" }] };
  }
}

function searchOrder(order: SearchOrder): Prisma.RequestOrderByWithRelationInput[] {
  if (order === "due") {
    // Nearest due date first; requests without SLA at the end, oldest first.
    return [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }];
  }

  const direction = order === "newest" ? "desc" : "asc";
  return [{ createdAt: direction }, { id: direction }];
}

function searchWhere(
  scope: RequestSearchScope,
  criteria: SearchCriteria,
  viewerId: string,
  now: Date,
): Prisma.RequestWhereInput {
  const and: Prisma.RequestWhereInput[] = [scope];

  if (criteria.statuses.length > 0) {
    and.push({ status: { in: criteria.statuses } });
  }

  if (criteria.openedFrom || criteria.openedBefore) {
    and.push({
      createdAt: {
        ...(criteria.openedFrom ? { gte: criteria.openedFrom } : {}),
        ...(criteria.openedBefore ? { lt: criteria.openedBefore } : {}),
      },
    });
  }

  if (criteria.term) {
    // Prisma passes `contains` to ILIKE without escaping % and _ (checked in
    // request-search.test.ts), so the term is escaped here.
    const pattern = escapeLikePattern(criteria.term);
    and.push({
      OR: [
        { description: { contains: pattern, mode: "insensitive" } },
        { serviceNameSnapshot: { contains: pattern, mode: "insensitive" } },
      ],
    });
  }

  if ("sectorId" in scope && criteria.assignee === "mine") {
    // The viewer is an active attendant of this sector, so holding it is effective.
    and.push({ assigneeId: viewerId });
  }

  if ("sectorId" in scope && criteria.assignee === "unassigned") {
    // Effective assignee only (SPEC de atribuição, 5.1): a holder who left counts as none.
    and.push({
      OR: [
        { assigneeId: null },
        {
          assignee: {
            OR: [
              { isActive: false },
              { role: { not: "ATTENDANT" } },
              { sectorId: null },
              { sectorId: { not: scope.sectorId } },
            ],
          },
        },
      ],
    });
  }

  if ("sectorId" in scope && criteria.sla) {
    and.push(slaWhere(criteria.sla, now));
  }

  return { AND: and };
}

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
    async search(scope, criteria, viewerId) {
      const where = searchWhere(scope, criteria, viewerId, new Date());
      const total = await database.request.count({ where });
      const window = pageWindow(total, criteria.page);
      const rows = await database.request.findMany({
        where,
        include: requestWithHistory,
        orderBy: searchOrder(criteria.order),
        skip: window.skip,
        take: window.take,
      });

      return { items: rows.map(toDomain), total, page: window.page, pageCount: window.pageCount };
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
    listActiveFields(serviceId) {
      return transaction.serviceField.findMany({
        where: { serviceId, isActive: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          type: true,
          isRequired: true,
          options: true,
          minValue: true,
          maxValue: true,
          position: true,
        },
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
    async insertFieldValues(values) {
      await transaction.requestFieldValue.createMany({ data: values });
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
          ...(update.expectedStageIndex !== undefined ? { stageIndex: update.expectedStageIndex } : {}),
        },
        data: {
          status: update.toStatus,
          updatedAt: update.updatedAt,
          ...(update.completedAt !== undefined ? { completedAt: update.completedAt } : {}),
          ...(update.cancelledAt ? { cancelledAt: update.cancelledAt } : {}),
          ...(update.completedLate !== undefined ? { completedLate: update.completedLate } : {}),
          ...(update.dueAt !== undefined ? { dueAt: update.dueAt } : {}),
          ...(update.resetSlaAlerts ? { slaWarningNotifiedAt: null, slaBreachNotifiedAt: null } : {}),
          ...(update.stageNamesSnapshot !== undefined ? { stageNamesSnapshot: update.stageNamesSnapshot } : {}),
          ...(update.stageIndex !== undefined ? { stageIndex: update.stageIndex } : {}),
        },
      });
      return result.count;
    },
    async listActiveStageNames(serviceId) {
      const stages = await transaction.serviceStage.findMany({
        where: { serviceId, isActive: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { name: true },
      });
      return stages.map(({ name }) => name);
    },
    async updateStageIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          status: "IN_PROGRESS",
          assigneeId: update.expectedAssigneeId,
          stageIndex: update.expectedStageIndex,
        },
        data: { stageIndex: update.stageIndex, updatedAt: update.updatedAt },
      });
      return result.count;
    },
    async insertStageEvent(event) {
      const { id } = await transaction.requestStageEvent.create({ data: event, select: { id: true } });
      return id;
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
          priority: true,
          slaHoursSnapshot: true,
          dueAt: true,
          serviceId: true,
          stageNamesSnapshot: true,
          stageIndex: true,
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
    async updatePriorityIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          status: update.expectedStatus,
          assigneeId: update.expectedAssigneeId,
          priority: update.expectedPriority,
        },
        data: {
          priority: update.priority,
          dueAt: update.dueAt,
          updatedAt: update.updatedAt,
          ...(update.resetSlaAlerts ? { slaWarningNotifiedAt: null, slaBreachNotifiedAt: null } : {}),
        },
      });
      return result.count;
    },
    async insertPriorityEvent(event) {
      await transaction.requestPriorityEvent.create({ data: event });
    },
    recordEvent(event) {
      return recordOutboxEvent(transaction, event);
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
