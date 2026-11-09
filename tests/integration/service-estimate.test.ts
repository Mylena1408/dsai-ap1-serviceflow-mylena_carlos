import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createService, updateService } from "@/modules/services";
import { getRequestTime, getTimeReport, logTime } from "@/modules/time-entries";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 1 (SF-227; CA-HRS-05; decision J4).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  actAs(admin);
  const base = { name: `Instalação ${sector.id}`, description: "Instalação", categoryId: category.id, sectorId: sector.id };
  const service = await createService(base, prisma);
  return { sector, admin, gabi, ana, rita, service, base };
}

describe("a service's estimate of hours (13.2 item 1)", () => {
  it("is configured from 1 to 200 whole hours, or none, and enters the audit trail", async () => {
    const { service, base } = await scenario();
    expect(service.estimatedHours).toBeNull();

    await expect(updateService(service.id, { ...base, estimatedHours: "4" }, prisma)).resolves.toMatchObject({ estimatedHours: 4 });
    for (const estimatedHours of ["0", "201", "1.5", "muito"]) {
      await expect(updateService(service.id, { ...base, estimatedHours }, prisma)).rejects.toBeInstanceOf(ValidationError);
    }
    // A form without the field keeps it; an empty one removes it.
    await expect(updateService(service.id, base, prisma)).resolves.toMatchObject({ estimatedHours: 4 });
    await expect(updateService(service.id, { ...base, estimatedHours: "" }, prisma)).resolves.toMatchObject({ estimatedHours: null });

    const entries = await prisma.auditEntry.findMany({
      where: { entityType: "SERVICE", entityId: service.id, action: "UPDATED" },
      orderBy: { occurredAt: "asc" },
      select: { changes: true },
    });
    expect(entries.map(({ changes }) => changes)).toEqual([
      [{ field: "estimatedHours", before: null, after: 4 }],
      [{ field: "estimatedHours", before: 4, after: null }],
    ]);
  });

  it("shows in the request and, for completed requests, in the report against the average logged", async () => {
    const { sector, gabi, ana, rita, service, base } = await scenario();
    await updateService(service.id, { ...base, estimatedHours: 4 }, prisma);
    const today = await organizationToday(prisma);
    const first = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const second = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    actAs(ana);
    await logTime({ requestId: first.id, workedOn: today, hours: 3, minutes: 0 });
    await logTime({ requestId: second.id, workedOn: today, hours: 5, minutes: 0 });
    expect(await getRequestTime(first.id)).toMatchObject({ totalMinutes: 180, estimatedHours: 4 });

    // Only completed requests enter the comparison.
    await prisma.request.update({ where: { id: first.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    actAs(gabi);
    expect((await getTimeReport({ period: "7" })).estimates).toEqual([
      { serviceId: service.id, serviceName: service.name, estimatedHours: 4, completed: 1, averageMinutes: 180 },
    ]);
    await prisma.request.update({ where: { id: second.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    expect((await getTimeReport({ period: "7" })).estimates).toMatchObject([{ completed: 2, averageMinutes: 240 }]);
  });
});
