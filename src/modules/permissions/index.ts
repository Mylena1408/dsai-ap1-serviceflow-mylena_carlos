import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/permission-use-cases";
import {
  createPrismaPermissionRepository,
  createPrismaPermissionTransactionRunner,
} from "./infrastructure/prisma-permission-repository";

// Public API of the permissions module (SPEC 2026-11-01-permissoes-configuraveis).

export {
  PERMISSIONS,
  PERMISSION_HOLDERS,
  assertCanGrantPermission,
  canReceivePermission,
  hasPermissionInSector,
  isPermissionEffective,
} from "./domain/permission";
export type { Permission, PermissionHolder, PermissionRole } from "./domain/permission";
export type { PermissionEventRecord, PermissionGrantRecord } from "./application/ports";
export type { PermissionOverview } from "./application/permission-use-cases";

export async function listPermissionOverview(database: PrismaClient = prisma): Promise<useCases.PermissionOverview> {
  return useCases.listPermissionOverview(createPrismaPermissionRepository(database));
}

export async function grantPermission(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return useCases.grantPermission(input, createPrismaPermissionTransactionRunner(database));
}

export async function revokePermission(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return useCases.revokePermission(input, createPrismaPermissionTransactionRunner(database));
}
