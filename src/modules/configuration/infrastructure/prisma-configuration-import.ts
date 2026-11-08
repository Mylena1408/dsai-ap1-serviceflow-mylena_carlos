import type { PrismaClient } from "@prisma/client";
import type { ConfigurationImportStore } from "../application/preview-import";
import { readConfigurationSnapshot } from "./prisma-configuration-export";

// What the import's preview reads (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4): the destination's
// configuration, the people the file cites (only their role, state and sector, never anything else) and
// what stops a sector from being deactivated, as the sectors' screen checks it.

export function createPrismaConfigurationImportStore(database: PrismaClient): ConfigurationImportStore {
  return {
    snapshot: () => readConfigurationSnapshot(database),
    async facts() {
      const [pending, attendants] = await Promise.all([
        database.sector.findMany({ where: { requests: { some: { status: { in: ["OPEN", "IN_PROGRESS"] } } } }, select: { name: true } }),
        database.sector.findMany({ where: { users: { some: { role: "ATTENDANT", isActive: true } } }, select: { name: true } }),
      ]);
      return { sectorsWithPendingRequests: pending.map(({ name }) => name), sectorsWithActiveAttendants: attendants.map(({ name }) => name) };
    },
    async people(emails) {
      if (emails.length === 0) return [];
      const rows = await database.user.findMany({
        where: { email: { in: [...emails], mode: "insensitive" } },
        select: { email: true, role: true, isActive: true, sector: { select: { name: true } } },
      });
      return rows.map((row) => ({ email: row.email, role: row.role, isActive: row.isActive, sectorName: row.sector?.name ?? null }));
    },
  };
}
