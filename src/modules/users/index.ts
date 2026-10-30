import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { hashPassword } from "@/modules/auth";
import * as useCases from "./application/user-use-cases";
import type { ManagedUser } from "./domain/user";
import {
  createPrismaUserRepository,
  createPrismaUserTransactionRunner,
} from "./infrastructure/prisma-user-repository";

export {
  assertAdministratorCanRetire,
  assertAttendantCanLeaveSector,
} from "./domain/user-rules";
export type { ManagedUser, UserRole } from "./domain/user";

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
