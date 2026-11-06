import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/canned-responses";
import { createPrismaCannedResponseRepository } from "./infrastructure/prisma-canned-responses";

// Canned responses of a sector (SPEC 2026-11-06-respostas-prontas).
export {
  MAX_CANNED_BODY_LENGTH,
  MAX_CANNED_TITLE_LENGTH,
  firstName,
  renderCannedResponse,
} from "./domain/canned-response";
export type { CannedResponseValues } from "./domain/canned-response";
export type { CannedResponseRecord } from "./application/canned-responses";

const repository = (database: PrismaClient) => createPrismaCannedResponseRepository(database);

export function listSectorResponses(database: PrismaClient = prisma) {
  return useCases.listSectorResponses(repository(database));
}

export function listActiveResponses(database: PrismaClient = prisma) {
  return useCases.listActiveResponses(repository(database));
}

export function createCannedResponse(input: unknown, database: PrismaClient = prisma) {
  return useCases.createCannedResponse(input, repository(database));
}

export function updateCannedResponse(id: unknown, input: unknown, database: PrismaClient = prisma) {
  return useCases.updateCannedResponse(id, input, repository(database));
}

export function setCannedResponseActive(id: unknown, isActive: boolean, database: PrismaClient = prisma) {
  return useCases.setCannedResponseActive(id, isActive, repository(database));
}

/** The active responses rendered for one request of the attendant's sector (4.4). */
export function listResponsesForRequest(requestId: unknown, database: PrismaClient = prisma) {
  return useCases.listResponsesForRequest(requestId, repository(database));
}
