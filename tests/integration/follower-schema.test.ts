import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-08-atendimento-dia-a-dia, 6.4 and 13.3 item 2 (SF-211; CA-SEG-05).

describe("followers in the database (6.4)", () => {
  it("a person follows a request once, with the history; a preference per person", async () => {
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const lia = await createDomainUser({ role: "REQUESTER" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    const now = new Date();

    await prisma.requestFollower.create({ data: { requestId: request.id, userId: lia.id, addedById: rita.id, createdAt: now } });
    await expect(prisma.requestFollower.create({ data: { requestId: request.id, userId: lia.id, addedById: rita.id, createdAt: now } })).rejects.toMatchObject({
      code: "P2002",
    });
    await prisma.requestFollowerEvent.create({ data: { requestId: request.id, userId: lia.id, action: "ADDED", actorId: rita.id, occurredAt: now } });
    expect(await prisma.requestFollowerEvent.count({ where: { requestId: request.id } })).toBe(1);

    await prisma.followPreference.create({ data: { userId: ana.id, autoFollowOnComment: false, updatedAt: now } });
    await expect(prisma.followPreference.create({ data: { userId: ana.id, autoFollowOnComment: true, updatedAt: now } })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});
