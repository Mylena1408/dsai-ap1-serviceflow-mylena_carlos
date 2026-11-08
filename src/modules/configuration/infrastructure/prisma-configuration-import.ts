import type { Prisma, PrismaClient } from "@prisma/client";
import type { ConfigurationImportStore } from "../application/preview-import";
import { readConfigurationSnapshot } from "./prisma-configuration-export";

// What the import's preview reads (SPEC 2026-11-07-operacao-e-automacao, 6.3 item 4): the destination's
// configuration, the people the file cites (only their id, role, state and sector) and what stops a sector
// from being deactivated, as the sectors' screen checks it.

type Client = PrismaClient | Prisma.TransactionClient;

export async function readFacts(client: Client) {
  const [pending, attendants] = await Promise.all([
    client.sector.findMany({ where: { requests: { some: { status: { in: ["OPEN", "IN_PROGRESS"] } } } }, select: { name: true } }),
    client.sector.findMany({ where: { users: { some: { role: "ATTENDANT", isActive: true } } }, select: { name: true } }),
  ]);
  return { sectorsWithPendingRequests: pending.map(({ name }) => name), sectorsWithActiveAttendants: attendants.map(({ name }) => name) };
}

export async function readPeople(client: Client, emails: readonly string[]) {
  if (emails.length === 0) return [];
  const rows = await client.user.findMany({
    where: { email: { in: [...emails], mode: "insensitive" } },
    select: { id: true, email: true, role: true, isActive: true, sector: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, email: row.email, role: row.role, isActive: row.isActive, sectorName: row.sector?.name ?? null }));
}

export function createPrismaConfigurationImportStore(database: PrismaClient): ConfigurationImportStore {
  return {
    snapshot: () => readConfigurationSnapshot(database),
    facts: () => readFacts(database),
    people: (emails) => readPeople(database, emails),
  };
}
