import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as bundles from "./application/bundles";
import { createPrismaBundleReader, createPrismaBundleStore } from "./infrastructure/prisma-bundles";

// Bundles of services (SPEC 2026-11-07-operacao-e-automacao, part A).
export {
  BUNDLE_PROBLEM_LABELS,
  MAX_BUNDLE_DESCRIPTION_LENGTH,
  MAX_BUNDLE_NAME_LENGTH,
  MAX_BUNDLE_SERVICES,
  MIN_BUNDLE_SERVICES,
  availabilityText,
  bundleAvailability,
  serviceProblems,
  type BundleAvailability,
  type BundleRecord,
  type BundleServiceProblem,
  type BundleServiceState,
} from "./domain/bundle";
export type { BundleOverview, BundleView } from "./application/bundles";

export function listBundleOverview(database: PrismaClient = prisma): Promise<bundles.BundleOverview> {
  return bundles.listBundleOverview(createPrismaBundleReader(database));
}

export function createBundle(input: unknown, database: PrismaClient = prisma) {
  return bundles.createBundle(input, createPrismaBundleStore(database));
}

export function updateBundle(id: unknown, input: unknown, database: PrismaClient = prisma) {
  return bundles.updateBundle(id, input, createPrismaBundleStore(database));
}

export function setBundleActive(id: unknown, isActive: unknown, database: PrismaClient = prisma) {
  return bundles.setBundleActive(id, isActive, createPrismaBundleStore(database));
}
