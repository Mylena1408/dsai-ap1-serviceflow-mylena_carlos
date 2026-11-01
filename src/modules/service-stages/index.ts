import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/service-stage-use-cases";
import type { ServiceStageRecord } from "./domain/service-stage";
import {
  createPrismaServiceStageRepository,
  createPrismaServiceStageTransactionRunner,
} from "./infrastructure/prisma-service-stage-repository";

// Public API of the attendance flow module (SPEC 2026-11-01-fluxos-configuraveis).

export {
  MAX_ACTIVE_SERVICE_STAGES,
  MAX_STAGE_NAME_LENGTH,
  assertCanAddActiveStage,
  assertStageNameAvailable,
} from "./domain/service-stage";
export type { ServiceStageRecord } from "./domain/service-stage";
export { serviceStageInputSchema } from "./application/service-stage-schemas";
export type { ServiceStageInput } from "./application/service-stage-schemas";

export async function listServiceStages(database: PrismaClient = prisma): Promise<ServiceStageRecord[]> {
  return useCases.listServiceStages(createPrismaServiceStageRepository(database));
}

export async function createServiceStage(
  serviceId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceStageRecord> {
  return useCases.createServiceStage(serviceId, input, createPrismaServiceStageTransactionRunner(database));
}

export async function renameServiceStage(
  stageId: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceStageRecord> {
  return useCases.renameServiceStage(stageId, input, createPrismaServiceStageTransactionRunner(database));
}

export async function moveServiceStage(
  stageId: unknown,
  direction: unknown,
  database: PrismaClient = prisma,
): Promise<void> {
  return useCases.moveServiceStage(stageId, direction, createPrismaServiceStageTransactionRunner(database));
}

export async function deactivateServiceStage(
  stageId: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceStageRecord> {
  return useCases.deactivateServiceStage(stageId, createPrismaServiceStageTransactionRunner(database));
}

export async function reactivateServiceStage(
  stageId: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceStageRecord> {
  return useCases.reactivateServiceStage(stageId, createPrismaServiceStageTransactionRunner(database));
}
