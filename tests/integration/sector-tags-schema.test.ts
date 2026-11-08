import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.4 (SF-194; CA-ETQ-05 and the rules of CA-ETQ-02 by the database).

describe("tags in the database (3.4)", () => {
  it("a name of 1 to 30 characters without spaces at the ends, a color of the palette, unique among the sector's active tags", async () => {
    const sector = await createDomainSector();
    const other = await createDomainSector();
    await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Rede", color: "blue" } });

    await expect(prisma.sectorTag.create({ data: { sectorId: sector.id, name: "REDE", color: "red" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.sectorTag.create({ data: { sectorId: other.id, name: "Rede", color: "red" } })).resolves.toMatchObject({ isActive: true });
    // An inactive tag frees the name.
    await expect(prisma.sectorTag.create({ data: { sectorId: sector.id, name: "rede", color: "gray", isActive: false } })).resolves.toMatchObject({ isActive: false });

    for (const data of [
      { sectorId: sector.id, name: "", color: "blue" },
      { sectorId: sector.id, name: " Espaço", color: "blue" },
      { sectorId: sector.id, name: "x".repeat(31), color: "blue" },
      { sectorId: sector.id, name: "Rosa", color: "pink" },
    ]) {
      await expect(prisma.sectorTag.create({ data })).rejects.toThrow(/SectorTag_values_check/);
    }
  });

  it("a tag goes on a request once, with its history", async () => {
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const tag = await prisma.sectorTag.create({ data: { sectorId: sector.id, name: "Urgente", color: "red" } });
    const now = new Date();

    await prisma.requestTag.create({ data: { requestId: request.id, tagId: tag.id, addedById: ana.id, addedAt: now } });
    await expect(prisma.requestTag.create({ data: { requestId: request.id, tagId: tag.id, addedById: ana.id, addedAt: now } })).rejects.toMatchObject({ code: "P2002" });
    await prisma.requestTagEvent.create({ data: { requestId: request.id, tagId: tag.id, action: "ADDED", actorId: ana.id, occurredAt: now } });
    expect(await prisma.requestTagEvent.findMany({ where: { requestId: request.id }, select: { action: true } })).toEqual([{ action: "ADDED" }]);
    // A tag in use is never deleted: it is deactivated.
    await expect(prisma.sectorTag.delete({ where: { id: tag.id } })).rejects.toThrow();
  });
});
