import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { getApplicationDocumentStorage, type DocumentStorage } from "@/server/storage";
import * as assignment from "./application/assignment";
import * as attachmentQueries from "./application/attachment-queries";
import * as createRequestUseCase from "./application/create-request";
import * as queries from "./application/request-queries";
import * as transitionUseCase from "./application/transition-request-status";
import type { AttachmentDownload, RequestAttachmentSummary } from "./domain/attachment";
import type { RequestWithHistory } from "./domain/request";
import { createPrismaAttachmentQueryRepository } from "./infrastructure/prisma-attachment-repository";
import {
  createPrismaRequestQueryRepository,
  createPrismaRequestTransactionRunner,
} from "./infrastructure/prisma-request-repository";

export { buildAttachmentContentDisposition } from "./domain/attachment";
export type { AttachmentDownload, RequestAttachmentSummary } from "./domain/attachment";
export { effectiveAssigneeId } from "./domain/lifecycle";
export { buildRequestSnapshot } from "./domain/snapshot";
export { assertRequestStatusTransition } from "./domain/status-transition";
export type {
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
