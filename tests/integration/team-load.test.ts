import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 item 8 (SF-183; CA-DST-06).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createRequest, getTeamLoad } from "@/modules/requests";
import { getAnalytics } from "@/modules/reports";
import { organizationToday } from "@/server/authorization/effective-permissions";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function named(role: Role, name: string, sectorId: string | null = null) {
  const user = await createDomainUser({ role, sectorId });
  return prisma.user.update({ where: { id: user.id }, data: { name } });
}

describe("the team's load and the analytics (4.3 item 8; CA-DST-06)", () => {
  it("counts active requests, the queue without an assignee and today's absences; the manager sees their sector", async () => {
    const sector = await createDomainSector();
    const other = await createDomainSector();
    await prisma.sector.update({ where: { id: sector.id }, data: { distributionMode: "ROUND_ROBIN", maxActivePerAttendant: 1 } });
    const service = await createDomainService({ categoryId: (await createDomainCategory()).id, sectorId: sector.id });
    const rita = await named("REQUESTER", "Rita");
    const ana = await named("ATTENDANT", "Ana", sector.id);
    const bia = await named("ATTENDANT", "Bia", sector.id);
    await named("ATTENDANT", "Zeca", other.id);
    const gabi = await named("MANAGER", "Gabi", sector.id);
    const admin = await named("ADMIN", "Admin");
    const today = await organizationToday(prisma);
    await prisma.attendantAbsence.create({ data: { userId: bia.id, createdById: bia.id, startsOn: new Date(`${today}T00:00:00Z`), endsOn: new Date(`${today}T00:00:00Z`) } });

    // Ana receives the first (Bia is absent) and reaches the limit; the second stays in the queue.
    actAs(rita);
    await createRequest({ serviceId: service.id, description: "Primeira" }, prisma);
    await createRequest({ serviceId: service.id, description: "Segunda" }, prisma);

    actAs(gabi);
    expect(await getTeamLoad(prisma)).toEqual([
      {
        sectorId: sector.id,
        sectorName: sector.name,
        mode: "ROUND_ROBIN",
        maxActivePerAttendant: 1,
        unassigned: 1,
        members: [
          { id: ana.id, name: "Ana", activeRequests: 1, absentToday: false },
          { id: bia.id, name: "Bia", activeRequests: 0, absentToday: true },
        ],
      },
    ]);

    actAs(admin);
    const all = await getTeamLoad(prisma);
    expect(all!.map(({ sectorId }) => sectorId).sort()).toEqual([sector.id, other.id].sort());
    expect((await getAnalytics({ period: "7", sector: sector.id }, prisma)).sla.distributedAutomatically).toBe(1);
    expect((await getAnalytics({ period: "7", sector: other.id }, prisma)).sla.distributedAutomatically).toBe(0);

    actAs(ana);
    await expect(getTeamLoad(prisma)).resolves.toBeNull();
  });
});
