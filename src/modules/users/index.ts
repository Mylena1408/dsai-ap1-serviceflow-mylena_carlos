import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { hashPassword } from "@/modules/auth";
import { getApplicationDocumentStorage, type DocumentStorage } from "@/server/storage";
import * as useCases from "./application/user-use-cases";
import * as anonymization from "./application/anonymize-user";
import type { ManagedUser } from "./domain/user";
import {
  createPrismaUserRepository,
  createPrismaUserTransactionRunner,
} from "./infrastructure/prisma-user-repository";
import { createPrismaAnonymizationTransactionRunner } from "./infrastructure/prisma-anonymization";

export {
  assertAdministratorCanRetire,
  assertAttendantCanLeaveSector,
} from "./domain/user-rules";
export type { ManagedUser, UserRole } from "./domain/user";
export {
  ANONYMIZED_CONTENT,
  REMOVED_ATTACHMENT_NAME,
  anonymizedIdentity,
  assertCanAnonymize,
} from "./domain/anonymization";
export type { AnonymizedUser } from "./application/anonymize-user";

const commands = (database: PrismaClient) => ({
  transactions: createPrismaUserTransactionRunner(database),
  hashPassword,
});

export async function listUsers(database: PrismaClient = prisma): Promise<ManagedUser[]> {
  return useCases.listUsers(createPrismaUserRepository(database));
}

export async function createUser(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ManagedUser> {
  return useCases.createUser(input, commands(database));
}

export async function updateUser(
  id: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ManagedUser> {
  return useCases.updateUser(id, input, commands(database));
}

export async function setUserActive(
  id: unknown,
  isActive: unknown,
  database: PrismaClient = prisma,
): Promise<ManagedUser> {
  return useCases.setUserActive(id, isActive, commands(database));
}

/** Anonymizes a deactivated person (SPEC 2026-11-02-auditoria-lgpd, 5.5); irreversible. */
export async function anonymizeUser(
  input: unknown,
  database: PrismaClient = prisma,
  storage: Pick<DocumentStorage, "remove"> = getApplicationDocumentStorage(),
): Promise<anonymization.AnonymizedUser> {
  return anonymization.anonymizeUser(input, {
    transactions: createPrismaAnonymizationTransactionRunner(database),
    files: storage,
  });
}
