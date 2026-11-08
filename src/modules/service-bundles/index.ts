import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as bundles from "./application/bundles";
import * as catalog from "./application/catalog";
import { createPrismaBundleReader, createPrismaBundleStore, createPrismaCatalogBundleReader } from "./infrastructure/prisma-bundles";

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
export type { CatalogBundle } from "./application/catalog";

/** Openable bundles of the catalog, for the requester (3.3 item 2). */
export function listCatalogBundles(database: PrismaClient = prisma): Promise<catalog.CatalogBundle[]> {
  return catalog.listCatalogBundles(createPrismaCatalogBundleReader(database));
}

export function getCatalogBundle(bundleId: unknown, database: PrismaClient = prisma): Promise<catalog.CatalogBundle> {
  return catalog.getCatalogBundle(bundleId, createPrismaCatalogBundleReader(database));
}

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

// The rules of this configuration screen, also used by the import's preview (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4).
export { bundleInputSchema } from "./domain/bundle";
