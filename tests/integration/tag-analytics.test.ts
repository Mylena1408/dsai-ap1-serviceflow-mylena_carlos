import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.1 item 4 (SF-198; CA-ETQ-04 for "Análises").

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnalytics } from "@/modules/reports";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
const now = new Date("2026-11-15T15:00:00.000Z");

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const tiService = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const rhService = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const rede = await prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Rede", color: "blue" } });
  const urgente = await prisma.sectorTag.create({ data: { sectorId: ti.id, name: "Urgente", color: "red" } });
  const folha = await prisma.sectorTag.create({ data: { sectorId: rh.id, name: "Folha", color: "green" } });

  const open = async (serviceId: string, sectorId: string, createdAt: Date, tagIds: string[]) => {
    const request = await createDomainRequest({ requesterId: rita.id, serviceId, sectorId, status: "OPEN" });
    await prisma.request.update({ where: { id: request.id }, data: { createdAt } });
    for (const tagId of tagIds) await prisma.requestTag.create({ data: { requestId: request.id, tagId, addedById: ana.id, addedAt: createdAt } });
  };
  const inPeriod = new Date("2026-11-10T12:00:00.000Z");
  await open(tiService.id, ti.id, inPeriod, [rede.id, urgente.id]);
  await open(tiService.id, ti.id, inPeriod, [rede.id]);
  await open(tiService.id, ti.id, inPeriod, []);
  await open(rhService.id, rh.id, inPeriod, [folha.id]);
  // Opened before the period: not counted.
  await open(tiService.id, ti.id, new Date("2026-09-01T12:00:00.000Z"), [urgente.id]);
  return { ti, rh, admin, gabi };
}

describe("tags in \"Análises\" (3.1 item 4; CA-ETQ-04)", () => {
  it("the manager sees the sector's requests per tag in the period, most used first", async () => {
    const { gabi } = await scenario();
    actAs(gabi);
    const analytics = await getAnalytics({ period: "custom", from: "2026-11-01", to: "2026-11-15" }, prisma, now);
    expect(analytics.tags).toEqual([
      { label: "Rede", count: 2 },
      { label: "Urgente", count: 1 },
    ]);
  });

  it("the administrator sees every sector's tags with the sector, or one sector's without it", async () => {
    const { admin, rh } = await scenario();
    actAs(admin);
    const all = await getAnalytics({ period: "custom", from: "2026-11-01", to: "2026-11-15" }, prisma, now);
    expect(all.tags.map(({ label }) => label)).toEqual([expect.stringMatching(/^Rede \(/), expect.stringMatching(/^Folha \(/), expect.stringMatching(/^Urgente \(/)]);
    const one = await getAnalytics({ period: "custom", from: "2026-11-01", to: "2026-11-15", sector: rh.id }, prisma, now);
    expect(one.tags).toEqual([{ label: "Folha", count: 1 }]);
  });

  it("without tags in the period there is nothing to show", async () => {
    const { gabi } = await scenario();
    actAs(gabi);
    expect((await getAnalytics({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, prisma, now)).tags).toEqual([]);
  });
});
