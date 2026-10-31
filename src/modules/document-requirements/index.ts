import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/document-requirement-use-cases";
import type { DocumentRequirementRecord } from "./domain/document-requirement";
import {
  createPrismaDocumentRequirementRepository,
  createPrismaDocumentRequirementTransactionRunner,
} from "./infrastructure/prisma-document-requirement-repository";

export {
  MAX_ACTIVE_DOCUMENT_REQUIREMENTS,
  assertCanAddActiveRequirement,
  planRequirementMove,
} from "./domain/requirement-order";
export type {
  DocumentFormat,
  DocumentRequirementData,
  DocumentRequirementRecord,
} from "./domain/document-requirement";

export async function listDocumentRequirements(
  database: PrismaClient = prisma,
): Promise<DocumentRequirementRecord[]> {
  return useCases.listDocumentRequirements(createPrismaDocumentRequirementRepository(database));
}

export async function listPublishedServiceRequirements(
  serviceId: unknown,
  database: PrismaClient = prisma,
): Promise<DocumentRequirementRecord[]> {
  return useCases.listPublishedServiceRequirements(
    serviceId,
    createPrismaDocumentRequirementRepository(database),
  );
}

export async function createDocumentRequirement(
  serviceId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<DocumentRequirementRecord> {
  return useCases.createDocumentRequirement(
    serviceId,
    input,
    createPrismaDocumentRequirementTransactionRunner(database),
  );
}

export async function updateDocumentRequirement(
  requirementId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<DocumentRequirementRecord> {
  return useCases.updateDocumentRequirement(
    requirementId,
    input,
    createPrismaDocumentRequirementTransactionRunner(database),
  );
}

export async function moveDocumentRequirement(
  requirementId: unknown,
  direction: unknown,
  database: PrismaClient = prisma,
): Promise<void> {
  return useCases.moveDocumentRequirement(
    requirementId,
    direction,
    createPrismaDocumentRequirementTransactionRunner(database),
  );
}

export async function deactivateDocumentRequirement(
  requirementId: unknown,
  database: PrismaClient = prisma,
): Promise<DocumentRequirementRecord> {
  return useCases.deactivateDocumentRequirement(
    requirementId,
    createPrismaDocumentRequirementTransactionRunner(database),
  );
}
