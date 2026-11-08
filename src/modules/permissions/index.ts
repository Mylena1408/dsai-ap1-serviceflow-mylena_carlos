import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as roles from "./application/access-roles";
import * as useCases from "./application/permission-use-cases";
import { createPrismaAccessRoleRepository, createPrismaAccessRoleTransactionRunner } from "./infrastructure/prisma-access-roles";
import {
  createPrismaPermissionRepository,
  createPrismaPermissionTransactionRunner,
} from "./infrastructure/prisma-permission-repository";

// Public API of the permissions module (SPEC 2026-11-01-permissoes-configuraveis), with roles and
// validity (SPEC 2026-11-06-aprofundamento-configurabilidade, part D).

export {
  PERMISSIONS,
  PERMISSION_HOLDERS,
  assertCanGrantPermission,
  canReceivePermission,
  hasPermissionInSector,
  isPermissionEffective,
} from "./domain/permission";
export type { Permission, PermissionHolder, PermissionRole } from "./domain/permission";
export {
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  MAX_ROLE_PERMISSIONS,
  receivablePermissions,
  type AccessRoleRecord,
} from "./domain/access-role";
export { MAX_VALIDITY_DAYS, isWithinValidity, validityLabel, validityState, type ValidityState } from "./domain/validity";
export type {
  AccessRoleSummary,
  PermissionEventRecord,
  PermissionGrantRecord,
  RoleAssignmentRecord,
  RoleEventRecord,
} from "./application/ports";
export type { PermissionOverview } from "./application/permission-use-cases";
export type { AccessRoleOverview } from "./application/access-roles";

export async function listPermissionOverview(database: PrismaClient = prisma): Promise<useCases.PermissionOverview> {
  return useCases.listPermissionOverview(createPrismaPermissionRepository(database));
}

export async function grantPermission(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return useCases.grantPermission(input, createPrismaPermissionTransactionRunner(database));
}

export async function revokePermission(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return useCases.revokePermission(input, createPrismaPermissionTransactionRunner(database));
}

export async function listAccessRoleOverview(database: PrismaClient = prisma): Promise<roles.AccessRoleOverview> {
  return roles.listAccessRoleOverview(createPrismaAccessRoleRepository(database));
}

export async function createAccessRole(input: unknown, database: PrismaClient = prisma) {
  return roles.createAccessRole(input, createPrismaAccessRoleTransactionRunner(database));
}

export async function updateAccessRole(id: unknown, input: unknown, database: PrismaClient = prisma) {
  return roles.updateAccessRole(id, input, createPrismaAccessRoleTransactionRunner(database));
}

export async function setAccessRoleActive(id: unknown, isActive: unknown, database: PrismaClient = prisma) {
  return roles.setAccessRoleActive(id, isActive, createPrismaAccessRoleTransactionRunner(database));
}

export async function assignAccessRole(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return roles.assignAccessRole(input, createPrismaAccessRoleTransactionRunner(database));
}

export async function removeAccessRole(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return roles.removeAccessRole(input, createPrismaAccessRoleTransactionRunner(database));
}

// The rules of this configuration screen, also used by the import's preview (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4).
export { accessRoleInputSchema } from "./domain/access-role";
