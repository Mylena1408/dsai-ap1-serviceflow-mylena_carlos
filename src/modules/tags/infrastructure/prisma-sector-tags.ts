import { Prisma, type PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { SectorTagReader, SectorTagStore, SectorTagTransaction } from "../application/sector-tags";
import type { TagColor, TagRecord } from "../domain/tag";

// The sectors' tags in PostgreSQL (SPEC 2026-11-08-atendimento-dia-a-dia, 3.4): the partial unique index refuses
// a name repeated among a sector's active tags (ignoring case); the CHECK bounds the name and the color.

const columns = { id: true, sectorId: true, name: true, color: true, isActive: true } as const;

const recordOf = (row: { id: string; sectorId: string; name: string; color: string; isActive: boolean }): TagRecord => ({
  ...row,
  color: row.color as TagColor,
});

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function createPrismaSectorTagReader(database: PrismaClient): SectorTagReader {
  return {
    async list(sectorId) {
      const sectors = await database.sector.findMany({
        where: { isActive: true, ...(sectorId ? { id: sectorId } : {}) },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          tags: {
            orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
            select: { ...columns, _count: { select: { requests: true } } },
          },
        },
      });
      return sectors.map((sector) => ({
        sector: { id: sector.id, name: sector.name },
        tags: sector.tags.map(({ _count, ...tag }) => ({ ...recordOf(tag), inUse: _count.requests })),
      }));
    },
  };
}

function transactionOf(client: Prisma.TransactionClient): SectorTagTransaction {
  return {
    ...createPrismaAuditScope(client),
    findSector(sectorId) {
      return client.sector.findUnique({ where: { id: sectorId }, select: { id: true, isActive: true } });
    },
    async findTag(tagId) {
      const row = await client.sectorTag.findUnique({ where: { id: tagId }, select: columns });
      return row && recordOf(row);
    },
    countActive(sectorId) {
      return client.sectorTag.count({ where: { sectorId, isActive: true } });
    },
    async create(tag) {
      try {
        return recordOf(await client.sectorTag.create({ data: tag, select: columns }));
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async update(tagId, data) {
      try {
        return recordOf(await client.sectorTag.update({ where: { id: tagId }, data, select: columns }));
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
  };
}

export function createPrismaSectorTagStore(database: PrismaClient): SectorTagStore {
  return {
    run(work) {
      // A repeated name is answered by the store itself; P2025 and P2034 as in the other screens.
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2025", "P2034"],
        fallbackMessage: "Sector tag change failed.",
      });
    },
  };
}
