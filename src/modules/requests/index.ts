import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as createRequestUseCase from "./application/create-request";
import * as queries from "./application/request-queries";
import * as transitionUseCase from "./application/transition-request-status";
import type { RequestWithHistory } from "./domain/request";
import {
  createPrismaRequestQueryRepository,
  createPrismaRequestTransactionRunner,
} from "./infrastructure/prisma-request-repository";

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
): Promise<CreatedRequest> {
  return createRequestUseCase.createRequest(
    input,
    createPrismaRequestTransactionRunner(database, {
      translate: ["P2003", "P2025"],
      fallbackMessage: "Request creation failed.",
    }),
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
