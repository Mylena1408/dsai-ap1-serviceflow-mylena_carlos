import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { BundleReader, BundleStore, BundleTransaction } from "../application/bundles";
import type { CatalogBundleReader } from "../application/catalog";
import type { BundleServiceState } from "../domain/bundle";

// Bundles in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 3.4). The shape and the unique active
// name are also checked by the database.

type Client = PrismaClient | Prisma.TransactionClient;

const bundleColumns = { id: true, name: true, description: true, serviceIds: true, isActive: true } as const;

async function serviceStates(client: Client, serviceIds?: readonly string[]): Promise<BundleServiceState[]> {
  const rows = await client.service.findMany({
    where: serviceIds ? { id: { in: [...serviceIds] } } : {},
    select: {
      id: true,
      name: true,
      isActive: true,
      category: { select: { isActive: true } },
      sector: { select: { name: true, isActive: true } },
      _count: { select: { documentRequirements: { where: { isActive: true } } } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sectorName: row.sector.name,
    isActive: row.isActive,
    categoryActive: row.category.isActive,
    sectorActive: row.sector.isActive,
    activeRequirements: row._count.documentRequirements,
  }));
}

export function createPrismaBundleReader(database: PrismaClient): BundleReader {
  return {
    listBundles() {
      return database.serviceBundle.findMany({ select: bundleColumns, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
    },
    listServiceStates: () => serviceStates(database),
  };
}

function transactionOf(client: Prisma.TransactionClient): BundleTransaction {
  return {
    ...createPrismaAuditScope(client),
    findBundle(bundleId) {
      return client.serviceBundle.findUnique({ where: { id: bundleId }, select: bundleColumns });
    },
    serviceStates: (serviceIds) => serviceStates(client, serviceIds),
    createBundle(input) {
      return client.serviceBundle.create({ data: input, select: bundleColumns });
    },
    updateBundle(bundleId, data) {
      return client.serviceBundle.update({ where: { id: bundleId }, data, select: bundleColumns });
    },
  };
}

export function createPrismaBundleStore(database: PrismaClient): BundleStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (transaction) => work(transactionOf(transaction)), {
        // A repeated active name: the partial unique index refuses it.
        translate: ["P2002", "P2025", "P2003", "P2034"],
        fallbackMessage: "Service bundle operation failed.",
      });
    },
  };
}

/** The bundles of the requester's catalog (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2). */
export function createPrismaCatalogBundleReader(database: PrismaClient): CatalogBundleReader {
  return {
    listActiveBundles() {
      return database.serviceBundle.findMany({ where: { isActive: true }, select: bundleColumns, orderBy: [{ name: "asc" }, { id: "asc" }] });
    },
    findBundle(bundleId) {
      return database.serviceBundle.findUnique({ where: { id: bundleId }, select: bundleColumns });
    },
    serviceStates: (serviceIds) => serviceStates(database, serviceIds),
  };
}
