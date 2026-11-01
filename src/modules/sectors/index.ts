import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as useCases from "./application/sector-use-cases";
import type { SectorRecord } from "./domain/sector";
import {
  createPrismaSectorRepository,
  createPrismaSectorTransactionRunner,
} from "./infrastructure/prisma-sector-repository";

export { assertSectorCanBeDeactivated } from "./domain/deactivation";
export type { SectorDeactivationDependencies } from "./domain/deactivation";
export type { SectorRecord } from "./domain/sector";

export async function listSectors(database: PrismaClient = prisma): Promise<SectorRecord[]> {
  return useCases.listSectors(createPrismaSectorRepository(database));
}

export async function listSectorsForCatalog(database: PrismaClient = prisma): Promise<SectorRecord[]> {
  return useCases.listSectorsForCatalog(createPrismaSectorRepository(database));
}

export async function createSector(
  input: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.createSector(input, createPrismaSectorTransactionRunner(database));
}

export async function updateSector(
  id: unknown,
  input: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.updateSector(id, input, createPrismaSectorTransactionRunner(database));
}

export async function setSectorActive(
  id: unknown,
  isActive: unknown,
  database: PrismaClient = prisma,
): Promise<SectorRecord> {
  return useCases.setSectorActive(id, isActive, createPrismaSectorTransactionRunner(database));
}
