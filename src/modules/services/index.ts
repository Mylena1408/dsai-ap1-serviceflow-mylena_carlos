import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as catalog from "./application/catalog-queries";
import * as useCases from "./application/service-use-cases";
import type { PublishedService, ServiceRecord } from "./domain/service";
import {
  createPrismaPublishedCatalogRepository,
  createPrismaServiceRepository,
  createPrismaServiceTransactionRunner,
} from "./infrastructure/prisma-service-repository";

export {
  assertServiceCanReceiveRequests,
  assertServiceRelationships,
} from "./domain/relationships";
export type { ServiceRelationships } from "./domain/relationships";
export { groupPublishedServices } from "./domain/service";
export type { PublishedService, ServiceData, ServiceRecord } from "./domain/service";

export async function listServices(database: PrismaClient = prisma): Promise<ServiceRecord[]> {
  return useCases.listServices(createPrismaServiceRepository(database));
}

export async function createService(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceRecord> {
  return useCases.createService(input, createPrismaServiceTransactionRunner(database));
}

export async function updateService(
  id: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceRecord> {
  return useCases.updateService(id, input, createPrismaServiceTransactionRunner(database));
}

export async function setServiceActive(
  id: unknown,
  isActive: unknown,
  database: PrismaClient = prisma,
): Promise<ServiceRecord> {
  return useCases.setServiceActive(id, isActive, createPrismaServiceTransactionRunner(database));
}

export async function listPublishedServices(
  database: PrismaClient = prisma,
): Promise<PublishedService[]> {
  return catalog.listPublishedServices(createPrismaPublishedCatalogRepository(database));
}

export async function getPublishedService(
  id: unknown,
  database: PrismaClient = prisma,
): Promise<PublishedService> {
  return catalog.getPublishedService(id, createPrismaPublishedCatalogRepository(database));
}
