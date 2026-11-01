import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getApplicationDocumentStorage, type DocumentStorage } from "@/server/storage";
import * as assignment from "./application/assignment";
import * as attachmentQueries from "./application/attachment-queries";
import * as createRequestUseCase from "./application/create-request";
import * as fieldAnswerQueries from "./application/field-answer-queries";
import * as lifecycleActions from "./application/lifecycle-actions";
import * as priorityUseCase from "./application/priority";
import * as queries from "./application/request-queries";
import * as slaAlerts from "./application/sla-alerts";
import * as stageUseCase from "./application/stages";
import * as approvalUseCase from "./application/approval";
import * as transitionUseCase from "./application/transition-request-status";
import type { AttachmentDownload, RequestAttachmentSummary } from "./domain/attachment";
import type { RequestFieldAnswer } from "./domain/field-answer";
import type { RequestWithHistory } from "./domain/request";
import { createPrismaFieldAnswerQueryRepository } from "./infrastructure/prisma-field-answer-repository";
import {
  createPrismaAttachmentQueryRepository,
  createPrismaRequestExistenceReader,
} from "./infrastructure/prisma-attachment-repository";
import * as orphanCleanup from "./application/orphan-cleanup";
import { createPrismaSlaAlertStore } from "./infrastructure/prisma-sla-alerts";
import {
  createPrismaRequestQueryRepository,
  createPrismaRequestTransactionRunner,
} from "./infrastructure/prisma-request-repository";

export { buildAttachmentContentDisposition } from "./domain/attachment";
export type { AttachmentDownload, RequestAttachmentSummary } from "./domain/attachment";
export type { RequestFieldAnswer } from "./domain/field-answer";
export { effectiveAssigneeId, REOPEN_WINDOW_MS } from "./domain/lifecycle";
export {
  MAX_SEARCH_TERM,
  MIN_SEARCH_TERM,
  SEARCH_PAGE_SIZE,
} from "./domain/search-criteria";
export type { AssigneeFilter, SearchCriteria, SearchOrder, SlaFilter } from "./domain/search-criteria";
export { slaSituation } from "./domain/sla";
export type { SlaSituation } from "./domain/sla";
export type { RequestSearchResult } from "./application/request-queries";
export { buildRequestSnapshot } from "./domain/snapshot";
export { assertRequestStatusTransition } from "./domain/status-transition";
export type {
  RequestPriority,
  RequestStatus,
  RequestSummary,
  RequestWithHistory,
} from "./domain/request";

export type CreatedRequest = RequestWithHistory;
export type RequestWithHistoryForRequester = RequestWithHistory;

export async function createRequest(
  input: unknown,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<CreatedRequest> {
  return createRequestUseCase.createRequest(
    input,
    createPrismaRequestTransactionRunner(database, {
      translate: ["P2003", "P2025"],
      fallbackMessage: "Request creation failed.",
    }),
    storage,
  );
}

export async function listRequestAttachments(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestAttachmentSummary[]> {
  return attachmentQueries.listRequestAttachments(
    requestId,
    createPrismaAttachmentQueryRepository(database),
  );
}

export async function listRequestFieldAnswers(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestFieldAnswer[]> {
  return fieldAnswerQueries.listRequestFieldAnswers(requestId, createPrismaFieldAnswerQueryRepository(database));
}

export async function getAttachmentDownload(
  requestId: unknown,
  attachmentId: unknown,
  database: PrismaClient = prisma,
  storage: DocumentStorage = getApplicationDocumentStorage(),
): Promise<AttachmentDownload> {
  return attachmentQueries.getAttachmentDownload(
    requestId,
    attachmentId,
    createPrismaAttachmentQueryRepository(database),
    storage,
  );
}

export async function listRequesterRequests(
  database: PrismaClient = prisma,
): Promise<RequestWithHistoryForRequester[]> {
  return queries.listRequesterRequests(createPrismaRequestQueryRepository(database));
}

// Manager area (SPEC 2026-11-01-aprovacoes, 5.7).
export async function listManagerApprovals(
  filter: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory[]> {
  return queries.listManagerApprovals(filter, createPrismaRequestQueryRepository(database));
}

export async function getManagerRequest(requestId: unknown, database: PrismaClient = prisma): Promise<RequestWithHistory> {
  return queries.getManagerRequest(requestId, createPrismaRequestQueryRepository(database));
}

export async function getRequesterRequest(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistoryForRequester> {
  return queries.getRequesterRequest(requestId, createPrismaRequestQueryRepository(database));
}

export async function listAttendantQueue(
  database: PrismaClient = prisma,
): Promise<RequestWithHistory[]> {
  return queries.listAttendantQueue(createPrismaRequestQueryRepository(database));
}

export async function getAttendantRequest(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory> {
  return queries.getAttendantRequest(requestId, createPrismaRequestQueryRepository(database));
}

export async function transitionRequestStatus(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<RequestWithHistory> {
  return transitionUseCase.transitionRequestStatus(
    input,
    createPrismaRequestTransactionRunner(database, {
      translate: ["P2034"],
      fallbackMessage: "Request transition failed.",
    }),
  );
}

const assignmentErrors = {
  translate: ["P2003", "P2034"] as const,
  fallbackMessage: "Request assignment failed.",
};

export async function assumeRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return assignment.assumeRequest(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

export async function releaseRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return assignment.releaseRequest(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

export async function transferRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return assignment.transferRequest(input, createPrismaRequestTransactionRunner(database, assignmentErrors));
}

export async function listTransferCandidates(
  requestId: unknown,
  database: PrismaClient = prisma,
): Promise<Array<{ id: string; name: string }>> {
  return queries.listTransferCandidates(requestId, createPrismaRequestQueryRepository(database));
}

const lifecycleErrors = {
  translate: ["P2034"] as const,
  fallbackMessage: "Request lifecycle change failed.",
};

export async function cancelRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return lifecycleActions.cancelRequest(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function reopenRequest(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return lifecycleActions.reopenRequest(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function searchRequesterRequests(
  rawParams: unknown,
  database: PrismaClient = prisma,
): Promise<queries.RequestSearchResult> {
  return queries.searchRequesterRequests(rawParams, createPrismaRequestQueryRepository(database));
}

export async function searchAttendantQueue(
  rawParams: unknown,
  database: PrismaClient = prisma,
): Promise<queries.RequestSearchResult> {
  return queries.searchAttendantQueue(rawParams, createPrismaRequestQueryRepository(database));
}

export type { OrphanCleanupSummary } from "./application/orphan-cleanup";

/** Removes attachment objects whose request never committed (daily job, SPEC 21.15.5). */
export async function cleanOrphanAttachmentObjects(
  now: Date,
  storage: DocumentStorage = getApplicationDocumentStorage(),
  database: PrismaClient = prisma,
): Promise<orphanCleanup.OrphanCleanupSummary> {
  return orphanCleanup.cleanOrphanAttachmentObjects(storage, createPrismaRequestExistenceReader(database), now);
}

export type { SlaAlertSummary } from "./application/sla-alerts";

/** Daily job step: records the SLA alerts owed at `now` (SPEC 2026-11-01, section 5.5). */
export async function recordSlaAlerts(now: Date, database: PrismaClient = prisma): Promise<slaAlerts.SlaAlertSummary> {
  return slaAlerts.recordSlaAlerts(now, createPrismaSlaAlertStore(database));
}

// Manager decision on a pending approval (SPEC 2026-11-01-aprovacoes, 5.4).
export async function decideApproval(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return approvalUseCase.decideApproval(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

// Advance or return one stage of the flow (SPEC 2026-11-01-fluxos-configuraveis, 5.3).
export async function moveRequestStage(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return stageUseCase.moveRequestStage(input, createPrismaRequestTransactionRunner(database, lifecycleErrors));
}

export async function changeRequestPriority(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return priorityUseCase.changeRequestPriority(
    input,
    createPrismaRequestTransactionRunner(database, lifecycleErrors),
  );
}
