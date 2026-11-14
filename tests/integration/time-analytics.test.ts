import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3 (SF-222; CA-CMP-03 for the hours): "Análises" sums the entries
// not removed by their day, on the request's current sector, in the scope of "Análises".

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
const PERIOD = { period: "custom", from: "2026-11-01", to: "2026-11-14" };

async function scenario() {
  const ti = await createDomainSector();
  const rh = await createDomainSector();
  const category = await createDomainCategory();
  const network = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const access = await createDomainService({ categoryId: category.id, sectorId: ti.id });
  const payroll = await createDomainService({ categoryId: category.id, sectorId: rh.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: ti.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: ti.id });
  const rita = await createDomainUser({ role: "REQUESTER" });

  const request = (serviceId: string, sectorId: string) => createDomainRequest({ requesterId: rita.id, serviceId, sectorId, status: "IN_PROGRESS" });
  const log = (requestId: string, day: string, minutes: number, deletedAt: Date | null = null) =>
    prisma.requestTimeEntry.create({ data: { requestId, userId: ana.id, workedOn: new Date(`${day}T00:00:00.000Z`), minutes, deletedAt } });

  const first = await request(network.id, ti.id);
  await log(first.id, "2026-11-01", 60);
  await log(first.id, "2026-11-14", 45);
  // Outside the period and removed: never counted.
  await log(first.id, "2026-10-31", 500);
  await log(first.id, "2026-11-15", 500);
  await log(first.id, "2026-11-05", 500, new Date("2026-11-06T10:00:00.000Z"));

  const second = await request(access.id, ti.id);
  await log(second.id, "2026-11-03", 30);

  // Logged while in TI, now in RH: it counts in RH, the request's current sector (as the time report).
  const moved = await request(network.id, ti.id);
  await log(moved.id, "2026-11-04", 120);
  await prisma.request.update({ where: { id: moved.id }, data: { sectorId: rh.id, sectorNameSnapshot: rh.name } });

  const third = await request(payroll.id, rh.id);
  await log(third.id, "2026-11-10", 15);

  return { ti, rh, network, access, payroll, admin, gabi };
}

describe("hours in \"Análises\" (SF-222)", () => {
  it("the manager sees the sector's hours by service, by each entry's day, without the removed ones", async () => {
    const { ti, network, access, gabi } = await scenario();
    actAs({ id: gabi.id, name: gabi.name, role: "MANAGER", sectorId: ti.id, isActive: true });

    const result = await getAnalytics(PERIOD, prisma, now);
    expect(result.sector?.id).toBe(ti.id);
    expect(result.time).toEqual({
      totalMinutes: 135,
      totalEntries: 3,
      bySector: [],
      byService: [
        { key: network.name, label: network.name, minutes: 105, entries: 2 },
        { key: access.name, label: access.name, minutes: 30, entries: 1 },
      ],
    });
  });

  it("the administrator over the organization sees the sectors, with each service's sector", async () => {
    const { ti, rh, network, payroll, admin } = await scenario();
    actAs({ id: admin.id, name: admin.name, role: "ADMIN", sectorId: null, isActive: true });

    const result = await getAnalytics(PERIOD, prisma, now);
    // Other tests may leave hours in the database: only this scenario's sectors are checked.
    const sectors = result.time.bySector.filter(({ key }) => key === ti.id || key === rh.id);
    // Both have 135 minutes; the order between them goes by name, which the fixtures draw at random.
    expect(sectors).toHaveLength(2);
    expect(sectors).toEqual(
      expect.arrayContaining([
        { key: rh.id, label: rh.name, minutes: 135, entries: 2 },
        { key: ti.id, label: ti.name, minutes: 135, entries: 3 },
      ]),
    );
    expect(result.time.byService).toEqual(
      expect.arrayContaining([
        { key: `${rh.id}:${network.name}`, label: `${network.name} (${rh.name})`, minutes: 120, entries: 1 },
        { key: `${rh.id}:${payroll.name}`, label: `${payroll.name} (${rh.name})`, minutes: 15, entries: 1 },
      ]),
    );
  });

  it("the administrator filtering one sector sees only it", async () => {
    const { rh, admin } = await scenario();
    actAs({ id: admin.id, name: admin.name, role: "ADMIN", sectorId: null, isActive: true });

    const result = await getAnalytics({ ...PERIOD, sector: rh.id }, prisma, now);
    expect(result.time.totalMinutes).toBe(135);
    expect(result.time.bySector).toEqual([]);
  });

  it("a period without entries has no hours", async () => {
    const { ti, gabi } = await scenario();
    actAs({ id: gabi.id, name: gabi.name, role: "MANAGER", sectorId: ti.id, isActive: true });

    const result = await getAnalytics({ period: "custom", from: "2026-09-01", to: "2026-09-30" }, prisma, now);
    expect(result.time).toEqual({ totalMinutes: 0, totalEntries: 0, bySector: [], byService: [] });
  });
});
