import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 5.4 and 13.2 item 1 (SF-206; CA-HRS-04 and the values of 5.3 item 2 by the
// database).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  const other = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  return { service, ana, request, other };
}

const day = (value: string) => new Date(`${value}T00:00:00Z`);

describe("time entries in the database (5.4)", () => {
  it("1 to 720 minutes and a note of 1 to 200 characters, or none", async () => {
    const { ana, request } = await scenario();
    const base = { requestId: request.id, userId: ana.id, workedOn: day("2026-11-08") };

    await expect(prisma.requestTimeEntry.create({ data: { ...base, minutes: 1 } })).resolves.toMatchObject({ note: null, deletedAt: null });
    await expect(prisma.requestTimeEntry.create({ data: { ...base, minutes: 720, note: "Visita" } })).resolves.toMatchObject({ minutes: 720 });
    for (const data of [
      { ...base, minutes: 0 },
      { ...base, minutes: 721 },
      { ...base, minutes: 30, note: "" },
      { ...base, minutes: 30, note: "x".repeat(201) },
    ]) {
      await expect(prisma.requestTimeEntry.create({ data })).rejects.toThrow(/RequestTimeEntry_values_check/);
    }
  });

  it("the history belongs to its entry's request; a removal only marks the entry", async () => {
    const { ana, request, other } = await scenario();
    const entry = await prisma.requestTimeEntry.create({ data: { requestId: request.id, userId: ana.id, workedOn: day("2026-11-08"), minutes: 60 } });
    const event = { entryId: entry.id, action: "CREATED" as const, workedOn: entry.workedOn, minutes: 60, actorId: ana.id, occurredAt: new Date() };

    await expect(prisma.requestTimeEntryEvent.create({ data: { ...event, requestId: request.id } })).resolves.toMatchObject({ action: "CREATED" });
    await expect(prisma.requestTimeEntryEvent.create({ data: { ...event, requestId: other.id } })).rejects.toThrow(/RequestTimeEntryEvent_same_request_fkey/);
    await expect(prisma.requestTimeEntryEvent.create({ data: { ...event, requestId: request.id, minutes: 0 } })).rejects.toThrow(
      /RequestTimeEntryEvent_minutes_check/,
    );
    // An entry with history is never deleted (decision I11): it is marked.
    await expect(prisma.requestTimeEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
  });

  it("a service's estimate of 1 to 200 hours, or none (13.2 item 1)", async () => {
    const { service } = await scenario();
    await expect(prisma.service.update({ where: { id: service.id }, data: { estimatedHours: 4 } })).resolves.toMatchObject({ estimatedHours: 4 });
    await expect(prisma.service.update({ where: { id: service.id }, data: { estimatedHours: null } })).resolves.toMatchObject({ estimatedHours: null });
    for (const estimatedHours of [0, 201]) {
      await expect(prisma.service.update({ where: { id: service.id }, data: { estimatedHours } })).rejects.toThrow(/Service_estimatedHours_check/);
    }
  });
});
