import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 item 1 and 4.4 (SF-180; CA-DST-01, 02 and 07).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { setSectorDistribution } from "@/modules/sectors";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

describe("distribution schema (4.4; CA-DST-07)", () => {
  it("every sector starts with the distribution off; the limit goes from 1 to 100", async () => {
    const sector = await createDomainSector();
    expect(await prisma.sector.findUniqueOrThrow({ where: { id: sector.id } })).toMatchObject({
      distributionMode: "NONE",
      maxActivePerAttendant: null,
      redistributeOnAbsence: false,
      lastDistributedToId: null,
    });
    for (const limit of [0, 101]) {
      await expect(prisma.sector.update({ where: { id: sector.id }, data: { maxActivePerAttendant: limit } })).rejects.toThrow(/Sector_maxActivePerAttendant_check/);
    }
    await expect(prisma.sector.update({ where: { id: sector.id }, data: { maxActivePerAttendant: 100 } })).resolves.toMatchObject({ maxActivePerAttendant: 100 });
  });

  it("a reason exists exactly when the system made the change (decision H19)", async () => {
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const base = { requestId: request.id, toAssigneeId: ana.id, occurredAt: new Date() };

    await expect(prisma.requestAssignmentEvent.create({ data: { ...base, actorId: ana.id } })).resolves.toMatchObject({ reason: null });
    await expect(prisma.requestAssignmentEvent.create({ data: { ...base, actorId: null, reason: "DISTRIBUTION" } })).resolves.toMatchObject({ actorId: null });
    await expect(prisma.requestAssignmentEvent.create({ data: { ...base, actorId: null } })).rejects.toThrow(/RequestAssignmentEvent_reason_check/);
    await expect(prisma.requestAssignmentEvent.create({ data: { ...base, actorId: ana.id, reason: "ABSENCE" } })).rejects.toThrow(/RequestAssignmentEvent_reason_check/);
  });

  it("an attendant's absence has a period of 1 to 90 days", async () => {
    const sector = await createDomainSector();
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
    const base = { userId: ana.id, createdById: ana.id };
    await expect(prisma.attendantAbsence.create({ data: { ...base, startsOn: day("2026-11-12"), endsOn: day("2026-11-10") } })).rejects.toThrow(/AttendantAbsence_period_check/);
    await expect(prisma.attendantAbsence.create({ data: { ...base, startsOn: day("2026-11-01"), endsOn: day("2027-01-30") } })).rejects.toThrow(/AttendantAbsence_period_check/);
    await expect(prisma.attendantAbsence.create({ data: { ...base, startsOn: day("2026-11-01"), endsOn: day("2027-01-29") } })).resolves.toMatchObject({ cancelledAt: null, redistributedAt: null });
  });
});

describe("distribution settings (4.3 item 1; CA-DST-02)", () => {
  it("only the administrator changes them, with the sector's audit trail", async () => {
    const sector = await createDomainSector();
    const admin = await createDomainUser({ role: "ADMIN" });
    const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });

    actAs(gabi);
    await expect(setSectorDistribution(sector.id, { distributionMode: "ROUND_ROBIN" }, prisma)).rejects.toBeInstanceOf(AuthorizationError);

    actAs(admin);
    await setSectorDistribution(sector.id, { distributionMode: "ROUND_ROBIN", maxActivePerAttendant: "5", redistributeOnAbsence: true }, prisma);
    await expect(setSectorDistribution(sector.id, { distributionMode: "SHUFFLE" }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(setSectorDistribution(sector.id, { distributionMode: "NONE", maxActivePerAttendant: 0 }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(setSectorDistribution(crypto.randomUUID(), { distributionMode: "NONE" }, prisma)).rejects.toBeInstanceOf(NotFoundError);

    expect(await prisma.sector.findUniqueOrThrow({ where: { id: sector.id } })).toMatchObject({
      distributionMode: "ROUND_ROBIN",
      maxActivePerAttendant: 5,
      redistributeOnAbsence: true,
    });
    const entry = await prisma.auditEntry.findFirstOrThrow({ where: { entityType: "SECTOR", entityId: sector.id, action: "UPDATED" } });
    expect(entry.changes).toEqual(
      expect.arrayContaining([
        { field: "distributionMode", before: "NONE", after: "ROUND_ROBIN" },
        { field: "maxActivePerAttendant", before: null, after: 5 },
        { field: "redistributeOnAbsence", before: false, after: true },
      ]),
    );
  });
});
