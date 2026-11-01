import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-fluxos-configuraveis, section 6 (SF-076).

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const requester = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: requester.id, serviceId: service.id, sectorId: sector.id });
  return { service, requester, request };
}

const stage = (serviceId: string, name: string, position = 0) =>
  prisma.serviceStage.create({ data: { serviceId, name, position } });

describe("attendance flow schema (SF-076)", () => {
  it("leaves existing services and requests without stages (CA-FLX-11)", async () => {
    const { service, request } = await scenario();

    await expect(prisma.serviceStage.count({ where: { serviceId: service.id } })).resolves.toBe(0);
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      stageNamesSnapshot: [],
      stageIndex: null,
    });
  });

  it("keeps stage names unique among the active ones, ignoring case, and checks the name", async () => {
    const { service } = await scenario();
    const first = await stage(service.id, "Triagem");

    await expect(stage(service.id, "TRIAGEM", 1)).rejects.toThrow();
    for (const name of ["", " Execução", "a".repeat(61)]) {
      await expect(stage(service.id, name, 1)).rejects.toThrow();
    }
    await expect(prisma.serviceStage.create({ data: { serviceId: service.id, name: "X", position: -1 } })).rejects.toThrow();

    await prisma.serviceStage.update({ where: { id: first.id }, data: { isActive: false } });
    await expect(stage(service.id, "Triagem", 1)).resolves.toBeTruthy();
    await expect(stage(service.id, "a".repeat(60), 2)).resolves.toBeTruthy();
  });

  it("ties the stage to a valid copy and never to an open request", async () => {
    const { request } = await scenario();
    const update = (data: { status?: "OPEN" | "IN_PROGRESS"; stageNamesSnapshot?: string[]; stageIndex?: number | null }) =>
      prisma.request.update({ where: { id: request.id }, data });

    await expect(update({ status: "IN_PROGRESS", stageIndex: 0 })).rejects.toThrow();
    await expect(update({ status: "IN_PROGRESS", stageNamesSnapshot: ["Triagem"] })).rejects.toThrow();
    await expect(update({ status: "IN_PROGRESS", stageNamesSnapshot: ["Triagem"], stageIndex: 1 })).rejects.toThrow();
    await expect(update({ stageNamesSnapshot: ["Triagem"], stageIndex: 0 })).rejects.toThrow(); // still OPEN
    await expect(update({ status: "IN_PROGRESS", stageNamesSnapshot: ["A", "a"], stageIndex: 0 })).rejects.toThrow();
    await expect(
      update({ status: "IN_PROGRESS", stageNamesSnapshot: Array.from({ length: 9 }, (_, i) => `E${i}`), stageIndex: 0 }),
    ).rejects.toThrow();
    await expect(
      update({ status: "IN_PROGRESS", stageNamesSnapshot: Array.from({ length: 8 }, (_, i) => `E${i}`), stageIndex: 7 }),
    ).resolves.toMatchObject({ stageIndex: 7 });
    await expect(update({ status: "OPEN", stageNamesSnapshot: [], stageIndex: null })).resolves.toMatchObject({
      stageIndex: null,
    });
  });

  it("records stage events with distinct stages and an optional reason, and accepts the new event type", async () => {
    const { requester, request } = await scenario();
    const event = (fromStage: string | null, toStage: string, note: string | null = null) =>
      prisma.requestStageEvent.create({
        data: { requestId: request.id, actorId: requester.id, fromStage, toStage, note, occurredAt: new Date() },
      });

    await expect(event("Triagem", "Triagem")).rejects.toThrow();
    await expect(event(null, "")).rejects.toThrow();
    await expect(event("Execução", "Triagem", "")).rejects.toThrow();
    await expect(event("Execução", "Triagem", "a".repeat(1001))).rejects.toThrow();
    await expect(event(null, "Triagem")).resolves.toBeTruthy();
    await expect(event("Execução", "Triagem", "Faltou informação")).resolves.toBeTruthy();

    const now = new Date();
    await expect(
      prisma.outboxEvent.create({
        data: { type: "request.stage_changed", requestId: request.id, payload: {}, occurredAt: now, availableAt: now },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.outboxEvent.create({
        data: { type: "request.unknown", requestId: request.id, payload: {}, occurredAt: now, availableAt: now },
      }),
    ).rejects.toThrow();
  });
});
