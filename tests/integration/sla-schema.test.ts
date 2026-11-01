import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-sla-prioridades, section 6 (SF-065).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  return { service, requester, request };
}

describe("SLA schema (SF-065)", () => {
  it("keeps existing-style services and requests NORMAL and without SLA (CA-SLA-10)", async () => {
    const { service, request } = await scenario();

    await expect(prisma.service.findUniqueOrThrow({ where: { id: service.id } })).resolves.toMatchObject({
      defaultPriority: "NORMAL",
      slaHours: null,
    });
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      priority: "NORMAL",
      slaHoursSnapshot: null,
      dueAt: null,
      completedLate: null,
    });
  });

  it("limits SLA hours to 1 to 2,000 and ties the due date to the snapshot", async () => {
    const { service, request } = await scenario();

    for (const slaHours of [0, 2001]) {
      await expect(prisma.service.update({ where: { id: service.id }, data: { slaHours } })).rejects.toThrow();
    }
    await expect(prisma.service.update({ where: { id: service.id }, data: { slaHours: 2000 } })).resolves.toBeTruthy();

    await expect(prisma.request.update({ where: { id: request.id }, data: { slaHoursSnapshot: 8 } })).rejects.toThrow();
    await expect(prisma.request.update({ where: { id: request.id }, data: { dueAt: new Date() } })).rejects.toThrow();
    await expect(
      prisma.request.update({ where: { id: request.id }, data: { slaHoursSnapshot: 8, dueAt: new Date() } }),
    ).resolves.toBeTruthy();
  });

  it("allows the completion result only on completed requests with SLA", async () => {
    const { request } = await scenario();
    await prisma.request.update({ where: { id: request.id }, data: { slaHoursSnapshot: 8, dueAt: new Date() } });

    await expect(prisma.request.update({ where: { id: request.id }, data: { completedLate: true } })).rejects.toThrow();
    await expect(
      prisma.request.update({
        where: { id: request.id },
        data: { status: "COMPLETED", completedAt: new Date(), completedLate: true },
      }),
    ).resolves.toMatchObject({ completedLate: true });
  });

  it("records only priority events that change the priority and accepts the new event types", async () => {
    const { requester, request } = await scenario();
    const event = (fromPriority: "NORMAL" | "HIGH", toPriority: "NORMAL" | "HIGH") =>
      prisma.requestPriorityEvent.create({
        data: { requestId: request.id, actorId: requester.id, fromPriority, toPriority, occurredAt: new Date() },
      });

    await expect(event("NORMAL", "NORMAL")).rejects.toThrow();
    await expect(event("NORMAL", "HIGH")).resolves.toBeTruthy();

    const now = new Date();
    for (const type of ["request.priority_changed", "request.sla_warning", "request.sla_breached"]) {
      await expect(
        prisma.outboxEvent.create({ data: { type, requestId: request.id, payload: {}, occurredAt: now, availableAt: now } }),
      ).resolves.toBeTruthy();
    }
    await expect(
      prisma.outboxEvent.create({
        data: { type: "request.unknown", requestId: request.id, payload: {}, occurredAt: now, availableAt: now },
      }),
    ).rejects.toThrow();
  });
});
