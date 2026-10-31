import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-10-31, section 6 (SF-047): additive migration and database constraints.

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const request = await createDomainRequest({
    requesterId: requester.id,
    serviceId: service.id,
    sectorId: sector.id,
  });

  return { sector, requester, attendant, request };
}

describe("request assignment schema (SF-047)", () => {
  it("starts existing-style requests without assignee or cancellation (CA-ATR-13)", async () => {
    const { request } = await scenario();
    const stored = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });

    expect(stored).toMatchObject({ assigneeId: null, cancelledAt: null, status: "OPEN" });
  });

  it("keeps cancelledAt filled exactly for cancelled requests", async () => {
    const { request } = await scenario();
    const now = new Date();

    await expect(
      prisma.request.update({ where: { id: request.id }, data: { status: "CANCELLED" } }),
    ).rejects.toThrow();
    await expect(
      prisma.request.update({ where: { id: request.id }, data: { cancelledAt: now } }),
    ).rejects.toThrow();
    await expect(
      prisma.request.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: now } }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
  });

  it("limits reasons on status events to 1 to 1,000 characters", async () => {
    const { request, requester } = await scenario();
    const event = (note: string | null) =>
      prisma.requestStatusEvent.create({
        data: { requestId: request.id, actorId: requester.id, fromStatus: "OPEN", toStatus: "OPEN", note },
      });

    await expect(event("")).rejects.toThrow();
    await expect(event("a".repeat(1_001))).rejects.toThrow();
    await expect(event("a".repeat(1_000))).resolves.toMatchObject({ note: "a".repeat(1_000) });
    await expect(event(null)).resolves.toMatchObject({ note: null });
  });

  it("records only assignment events that change the assignee", async () => {
    const { request, attendant, sector } = await scenario();
    const other = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const event = (fromAssigneeId: string | null, toAssigneeId: string | null) =>
      prisma.requestAssignmentEvent.create({
        data: { requestId: request.id, actorId: attendant.id, fromAssigneeId, toAssigneeId },
      });

    await expect(event(null, null)).rejects.toThrow();
    await expect(event(attendant.id, attendant.id)).rejects.toThrow();
    await expect(event(null, attendant.id)).resolves.toBeTruthy();
    await expect(event(attendant.id, other.id)).resolves.toBeTruthy();
    await expect(event(other.id, null)).resolves.toBeTruthy();
  });

  it("does not let an assigned user be deleted physically", async () => {
    const { request, attendant } = await scenario();
    await prisma.request.update({ where: { id: request.id }, data: { assigneeId: attendant.id } });

    await expect(prisma.user.delete({ where: { id: attendant.id } })).rejects.toThrow();
  });
});
