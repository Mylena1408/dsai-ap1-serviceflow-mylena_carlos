import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-aprovacoes, section 6 (SF-081).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const manager = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  return { sector, service, requester, manager, request };
}

const update = (id: string, data: Prisma.RequestUncheckedUpdateInput) => prisma.request.update({ where: { id }, data });

describe("approval schema (SF-081)", () => {
  it("leaves existing services and requests without approval (CA-APR-10)", async () => {
    const { service, request } = await scenario();

    await expect(prisma.service.findUniqueOrThrow({ where: { id: service.id } })).resolves.toMatchObject({
      requiresApproval: false,
    });
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      approvalState: null,
    });
  });

  it("requires a sector for managers, as for attendants, and none for the other roles", async () => {
    const sector = await createDomainSector();

    await expect(createDomainUser({ role: "MANAGER", sectorId: sector.id })).resolves.toMatchObject({ role: "MANAGER" });
    await expect(createDomainUser({ role: "MANAGER" })).rejects.toThrow();
    await expect(createDomainUser({ role: "ATTENDANT" })).rejects.toThrow();
    await expect(createDomainUser({ role: "REQUESTER", sectorId: sector.id })).rejects.toThrow();
    await expect(createDomainUser({ role: "ADMIN", sectorId: sector.id })).rejects.toThrow();
  });

  it("keeps the approval consistent with the status and without a due date before the approval", async () => {
    const { request } = await scenario();

    await expect(update(request.id, { approvalState: "PENDING" })).resolves.toBeTruthy();
    await expect(update(request.id, { slaHoursSnapshot: 8 })).resolves.toBeTruthy(); // hours kept, no due date yet
    await expect(update(request.id, { dueAt: new Date() })).rejects.toThrow();
    await expect(update(request.id, { status: "IN_PROGRESS" })).rejects.toThrow();
    await expect(update(request.id, { approvalState: "REJECTED" })).rejects.toThrow(); // still OPEN
    await expect(
      update(request.id, { approvalState: "REJECTED", status: "CANCELLED", cancelledAt: new Date() }),
    ).resolves.toBeTruthy();
  });

  it("gives the due date at the approval and keeps the SLA rule for requests without approval", async () => {
    const { request } = await scenario();
    await update(request.id, { approvalState: "PENDING", slaHoursSnapshot: 8 });

    await expect(update(request.id, { approvalState: "APPROVED" })).rejects.toThrow(); // hours without due date
    await expect(update(request.id, { approvalState: "APPROVED", dueAt: new Date() })).resolves.toBeTruthy();
    await expect(update(request.id, { status: "IN_PROGRESS" })).resolves.toBeTruthy();

    const plain = await scenario();
    await expect(update(plain.request.id, { slaHoursSnapshot: 8 })).rejects.toThrow();
  });

  it("stores one decision per request; a rejection always has a note", async () => {
    const { request, manager } = await scenario();
    const decide = (decision: "APPROVED" | "REJECTED", note: string | null) =>
      prisma.requestApproval.create({
        data: { requestId: request.id, deciderId: manager.id, decision, note, decidedAt: new Date() },
      });

    await expect(decide("REJECTED", null)).rejects.toThrow();
    await expect(decide("REJECTED", " ")).rejects.toThrow();
    await expect(decide("APPROVED", "a".repeat(1001))).rejects.toThrow();
    await expect(decide("APPROVED", null)).resolves.toBeTruthy();
    await expect(decide("REJECTED", "Fora do orçamento")).rejects.toThrow(); // one per request
  });

  it("accepts the approval event type", async () => {
    const { request } = await scenario();
    const now = new Date();

    await expect(
      prisma.outboxEvent.create({
        data: { type: "request.approval_decided", requestId: request.id, payload: {}, occurredAt: now, availableAt: now },
      }),
    ).resolves.toBeTruthy();
  });
});
