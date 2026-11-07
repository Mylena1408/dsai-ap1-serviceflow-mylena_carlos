import { Prisma, type PrismaClient } from "@prisma/client";
import { loadBusinessCalendar } from "@/modules/calendar";
import {
  runSerializableTransaction,
  type PersistenceErrorPolicy,
} from "@/server/db/serializable-transaction";
import { recordOutboxEvent } from "@/modules/events";
import { decimalLimitText } from "@/modules/service-fields";
import { approvalCoverage } from "./approval-coverage";
import type { RequestStatus, RequestWithHistory } from "../domain/request";
import {
  DIGIT_ANSWER_TYPES,
  digitsSearchTerm,
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
  // One decision per level (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.4), with the
  // absent manager the decider replaced (4.3.5).
  approvals: {
    orderBy: [{ level: "asc" }, { decidedAt: "asc" }],
    include: { decider: { select: { id: true, name: true } }, onBehalfOf: { select: { id: true, name: true } } },
  },
  assignmentEvents: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: {
      actor: { select: { id: true, name: true } },
      fromAssignee: { select: { id: true, name: true } },
      toAssignee: { select: { id: true, name: true } },
    },
  },
  sectorEvents: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: { actor: { select: { id: true, name: true } } },
  },
  // SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.3.
  fieldUpdates: {
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    include: { actor: { select: { id: true, name: true } } },
  },
  // SPEC 2026-11-03-pausa-sla-calendario, 5.5.
  slaPauses: {
    orderBy: [{ pausedAt: "asc" }, { id: "asc" }],
    include: { pausedBy: { select: { id: true, name: true } }, resumedBy: { select: { id: true, name: true } } },
  },
  // Only what the history needs (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.5).
  attachments: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, requirementNameSnapshot: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } },
  },
} satisfies Prisma.RequestInclude;

const lifecycleUser = { id: true, role: true, isActive: true, sectorId: true } as const;

/**
 * Requests whose pending level this sector decides (SPEC 2026-11-06-aprofundamento-configurabilidade,
 * 4.3.4). A request opened before levels has no pending sector: its own sector decides.
 */
function pendingForSector(sectorId: string): Prisma.RequestWhereInput {
  return {
    approvalState: "PENDING",
    OR: [{ approvalPendingSectorId: sectorId }, { approvalPendingSectorId: null, sectorId }],
  };
}

/** Requests with approval that the managers of a sector see: their sector's, or with one of their levels. */
function approvalVisibleTo(sectorId: string): Prisma.RequestWhereInput {
  return {
    approvalState: { not: null },
    OR: [{ sectorId }, { approvalSectorIdsSnapshot: { has: sectorId } }],
  };
}

// Compile-time check that the Prisma row matches the domain type exactly.
type RequestWithHistoryRow = Prisma.RequestGetPayload<{
  include: typeof requestWithHistory;
}>;
// The domain keeps the last decision as `approval`, as before levels, and the full list.
const toDomain = ({ approvals, ...row }: RequestWithHistoryRow): RequestWithHistory => ({
  ...row,
  approvals,
  approval: approvals.at(-1) ?? null,
});

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
    // A paused request is only "paused" (SPEC 2026-11-03-pausa-sla-calendario, 5.3.4).
    case "on_time":
      return { status: { in: ACTIVE_STATUSES }, slaPausedAt: null, dueSoonAt: { gt: now } };
    case "due_soon":
      return { status: { in: ACTIVE_STATUSES }, slaPausedAt: null, dueSoonAt: { lte: now }, dueAt: { gte: now } };
    case "overdue":
      return { status: { in: ACTIVE_STATUSES }, slaPausedAt: null, dueAt: { lt: now } };
    case "paused":
      return { slaPausedAt: { not: null } };
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
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.5: also the field answers. The
    // requester only searches what the requester sees: answers without an attendance author
    // (SPEC 2026-11-03-campos-condicionais-atendimento, CA-CND-08).
    const visibleAnswers: Prisma.RequestFieldValueWhereInput = "requesterId" in scope ? { updatedById: null } : {};
    const digits = digitsSearchTerm(criteria.term);
    and.push({
      OR: [
        { description: { contains: pattern, mode: "insensitive" } },
        { serviceNameSnapshot: { contains: pattern, mode: "insensitive" } },
        { fieldValues: { some: { ...visibleAnswers, value: { contains: pattern, mode: "insensitive" } } } },
        ...(digits
          ? [{ fieldValues: { some: { ...visibleAnswers, typeSnapshot: { in: [...DIGIT_ANSWER_TYPES] }, value: { contains: digits } } } }]
          : []),
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
    async listForApproval(sectorId, onlyPending, coveredSectorIds = []) {
      const sectors = [sectorId, ...coveredSectorIds];
      const rows = await database.request.findMany({
        where: { OR: sectors.map((item) => (onlyPending ? pendingForSector(item) : approvalVisibleTo(item))) },
        include: requestWithHistory,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      // Pending first, oldest first (SPEC 2026-11-01-aprovacoes, 5.7).
      return rows
        .sort((left, right) => Number(right.approvalState === "PENDING") - Number(left.approvalState === "PENDING"))
        .map(toDomain);
    },
    approvalCoverage(managerId) {
      return approvalCoverage(database, managerId);
    },
    async findForApproval(requestId, sectorId, coveredSectorIds = []) {
      const row = await database.request.findFirst({
        where: { id: requestId, OR: [sectorId, ...coveredSectorIds].map(approvalVisibleTo) },
        include: requestWithHistory,
      });
      return row && toDomain(row);
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
    listSectorDestinations(currentSectorId) {
      return database.sector.findMany({
        where: { id: { not: currentSectorId }, isActive: true, users: { some: { role: "ATTENDANT", isActive: true } } },
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
  };
}

export function createPrismaRequestTransaction(
  transaction: Prisma.TransactionClient,
): RequestTransaction {
  return {
    loadBusinessCalendar() {
      return loadBusinessCalendar(transaction);
    },
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
    async listActiveFields(serviceId) {
      const rows = await transaction.serviceField.findMany({
        // The opening form has only the requester's fields (SPEC 2026-11-03-campos-condicionais-atendimento, 5.4).
        where: { serviceId, isActive: true, audience: "REQUESTER" },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          type: true,
          isRequired: true,
          options: true,
          minValue: true,
          maxValue: true,
          decimalPlaces: true,
          minDecimal: true,
          maxDecimal: true,
          position: true,
          conditionFieldId: true,
          conditionValue: true,
        },
      });
      return rows.map(withDecimalLimitsAsText);
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
    listRequestDocuments(requestId) {
      return transaction.requestAttachment.findMany({ where: { requestId }, select: { requirementId: true, sizeBytes: true } });
    },
    async insertFieldValues(values) {
      await transaction.requestFieldValue.createMany({ data: values });
    },
    // SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.
    async listActiveAttendanceFields(serviceId) {
      const rows = await transaction.serviceField.findMany({
        where: { serviceId, isActive: true, audience: "ATTENDANT" },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          helpText: true,
          type: true,
          isRequired: true,
          options: true,
          minValue: true,
          maxValue: true,
          decimalPlaces: true,
          minDecimal: true,
          maxDecimal: true,
          position: true,
          conditionFieldId: true,
          conditionValue: true,
        },
      });
      return rows.map(withDecimalLimitsAsText);
    },
    async listAttendanceAnswers(requestId) {
      const rows = await transaction.requestFieldValue.findMany({
        where: { requestId, updatedById: { not: null } },
        select: { fieldId: true, typeSnapshot: true, value: true },
      });
      return rows.map((row) => ({ fieldId: row.fieldId, type: row.typeSnapshot, value: row.value }));
    },
    async saveAttendanceAnswers({ requestId, actorId, at, upserts, removals }) {
      if (removals.length > 0) {
        await transaction.requestFieldValue.deleteMany({ where: { requestId, fieldId: { in: removals }, updatedById: { not: null } } });
      }
      for (const answer of upserts) {
        const data = {
          labelSnapshot: answer.labelSnapshot,
          typeSnapshot: answer.typeSnapshot,
          positionSnapshot: answer.positionSnapshot,
          value: answer.value,
          updatedAt: at,
          updatedById: actorId,
        };
        await transaction.requestFieldValue.upsert({
          where: { requestId_fieldId: { requestId, fieldId: answer.fieldId } },
          create: { requestId, fieldId: answer.fieldId, createdAt: at, ...data },
          update: data,
        });
      }
    },
    async insertFieldUpdateEvent(event) {
      await transaction.requestFieldUpdateEvent.create({ data: event });
    },
    async touchRequestIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: { id: update.requestId, status: update.expectedStatus, assigneeId: update.expectedAssigneeId },
        data: { updatedAt: update.updatedAt },
      });
      return result.count;
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
          ...(update.expectedSlaPausedAt !== undefined ? { slaPausedAt: update.expectedSlaPausedAt } : {}),
        },
        data: {
          status: update.toStatus,
          updatedAt: update.updatedAt,
          ...(update.completedAt !== undefined ? { completedAt: update.completedAt } : {}),
          ...(update.cancelledAt ? { cancelledAt: update.cancelledAt } : {}),
          ...(update.completedLate !== undefined ? { completedLate: update.completedLate } : {}),
          ...(update.dueAt !== undefined ? { dueAt: update.dueAt } : {}),
          ...(update.dueSoonAt !== undefined ? { dueSoonAt: update.dueSoonAt } : {}),
          ...(update.slaPausedAt !== undefined ? { slaPausedAt: update.slaPausedAt } : {}),
          ...(update.resetSlaAlerts ? { slaWarningNotifiedAt: null, slaBreachNotifiedAt: null } : {}),
          ...(update.stageNamesSnapshot !== undefined ? { stageNamesSnapshot: update.stageNamesSnapshot } : {}),
          ...(update.stageIndex !== undefined ? { stageIndex: update.stageIndex } : {}),
        },
      });
      return result.count;
    },
    async updateApprovalIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          status: "OPEN",
          approvalState: "PENDING",
          ...(update.expectedLevel !== undefined ? { approvalLevel: update.expectedLevel } : {}),
        },
        data: {
          approvalState: update.approvalState,
          updatedAt: update.updatedAt,
          ...(update.approvalLevel !== undefined ? { approvalLevel: update.approvalLevel } : {}),
          ...(update.approvalPendingSectorId !== undefined ? { approvalPendingSectorId: update.approvalPendingSectorId } : {}),
          ...(update.dueAt !== undefined ? { dueAt: update.dueAt } : {}),
          ...(update.dueSoonAt !== undefined ? { dueSoonAt: update.dueSoonAt } : {}),
          ...(update.status ? { status: update.status, cancelledAt: update.cancelledAt } : {}),
        },
      });
      return result.count;
    },
    async insertApproval(approval) {
      await transaction.requestApproval.create({ data: approval });
    },
    approvalCoverage(managerId) {
      return approvalCoverage(transaction, managerId);
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
          approvalState: true,
          approvalSectorIdsSnapshot: true,
          approvalLevel: true,
          approvalPendingSectorId: true,
          slaBusinessHours: true,
          slaPausedAt: true,
          assignee: { select: lifecycleUser },
        },
      });
    },
    async findPermissions(userId) {
      const grants = await transaction.userPermission.findMany({ where: { userId }, select: { permission: true } });
      return grants.map(({ permission }) => permission);
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
          ...(update.dueSoonAt !== undefined ? { dueSoonAt: update.dueSoonAt } : {}),
          updatedAt: update.updatedAt,
          ...(update.resetSlaAlerts ? { slaWarningNotifiedAt: null, slaBreachNotifiedAt: null } : {}),
        },
      });
      return result.count;
    },
    async insertPriorityEvent(event) {
      await transaction.requestPriorityEvent.create({ data: event });
    },
    async updateSlaPauseIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          status: "IN_PROGRESS",
          assigneeId: update.expectedAssigneeId,
          slaPausedAt: update.expectedSlaPausedAt,
        },
        data: {
          slaPausedAt: update.slaPausedAt,
          updatedAt: update.updatedAt,
          ...(update.dueAt !== undefined ? { dueAt: update.dueAt } : {}),
          ...(update.dueSoonAt !== undefined ? { dueSoonAt: update.dueSoonAt } : {}),
        },
      });
      return result.count;
    },
    async insertSlaPause(pause) {
      const { id } = await transaction.requestSlaPause.create({ data: pause, select: { id: true } });
      return id;
    },
    async closeOpenSlaPause({ requestId, ...closing }) {
      const open = await transaction.requestSlaPause.findFirst({ where: { requestId, resumedAt: null }, select: { id: true } });

      if (!open) {
        return null;
      }

      await transaction.requestSlaPause.update({ where: { id: open.id }, data: closing });
      return open.id;
    },
    async findSectorDestination(sectorId) {
      const sector = await transaction.sector.findUnique({
        where: { id: sectorId },
        select: {
          id: true,
          name: true,
          isActive: true,
          _count: { select: { users: { where: { role: "ATTENDANT", isActive: true } } } },
        },
      });
      return sector && { id: sector.id, name: sector.name, isActive: sector.isActive, activeAttendants: sector._count.users };
    },
    async updateSectorIfCurrent(update) {
      const result = await transaction.request.updateMany({
        where: {
          id: update.requestId,
          status: "OPEN",
          sectorId: update.expectedSectorId,
          assigneeId: update.expectedAssigneeId,
          // A pending approval stays with the managers of the current sector (decision T3).
          OR: [{ approvalState: null }, { approvalState: { not: "PENDING" } }],
        },
        data: { sectorId: update.sectorId, sectorNameSnapshot: update.sectorName, assigneeId: null, updatedAt: update.updatedAt },
      });
      return result.count;
    },
    async insertSectorEvent(event) {
      await transaction.requestSectorEvent.create({ data: event });
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

/**
 * Explicit limit of the request transactions (SPEC 2026-11-06-transacao-abertura, 2.2), instead of
 * Prisma's implicit 5 s: room for a slow database or network without holding locks for long.
 */
export const REQUEST_TRANSACTION_TIMEOUT_MS = 10_000;

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
        { timeoutMs: REQUEST_TRANSACTION_TIMEOUT_MS },
      );
    },
  };
}

/** Decimal limits as text with the field's places (SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1). */
function withDecimalLimitsAsText<T extends { decimalPlaces: number | null; minDecimal: Prisma.Decimal | null; maxDecimal: Prisma.Decimal | null }>(
  row: T,
): Omit<T, "minDecimal" | "maxDecimal"> & { minDecimal: string | null; maxDecimal: string | null } {
  return {
    ...row,
    minDecimal: decimalLimitText(row.minDecimal, row.decimalPlaces),
    maxDecimal: decimalLimitText(row.maxDecimal, row.decimalPlaces),
  };
}
