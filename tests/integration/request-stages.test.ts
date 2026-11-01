import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { assumeRequest, moveRequestStage, reopenRequest, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-01-fluxos-configuraveis, sections 5.2 to 5.5 (SF-078).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario(stageNames: string[] = ["Triagem", "Execução", "Testes"]) {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  for (const [position, name] of stageNames.entries()) {
    await prisma.serviceStage.create({ data: { serviceId: service.id, name, position } });
  }
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  return { service, rita, ana, bia, caio, admin, request };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const stageEvents = (requestId: string) =>
  prisma.requestStageEvent.findMany({ where: { requestId }, orderBy: { occurredAt: "asc" } });
const start = (requestId: string) => transitionRequestStatus({ requestId, toStatus: "IN_PROGRESS" }, prisma);
const complete = (requestId: string) => transitionRequestStatus({ requestId, toStatus: "COMPLETED" }, prisma);
// Sends the stage currently stored, as the page does with the stage it shows.
async function fromStage(requestId: string): Promise<number> {
  return (await stored(requestId)).stageIndex ?? 0;
}
const advance = async (requestId: string) =>
  moveRequestStage({ requestId, direction: "advance", fromStageIndex: await fromStage(requestId) }, prisma);
const goBack = async (requestId: string, note?: string) =>
  moveRequestStage({ requestId, direction: "return", fromStageIndex: await fromStage(requestId), note }, prisma);

describe("stages in the attendance (SF-078)", () => {
  it("copies the flow on start and records the first stage with its event (CA-FLX-04, 08)", async () => {
    const { ana, request, service } = await scenario();
    await prisma.serviceStage.create({ data: { serviceId: service.id, name: "Inativa", position: 1, isActive: false } });
    actAs(ana);

    await start(request.id);

    await expect(stored(request.id)).resolves.toMatchObject({
      status: "IN_PROGRESS",
      stageNamesSnapshot: ["Triagem", "Execução", "Testes"],
      stageIndex: 0,
    });
    const [first] = await stageEvents(request.id);
    expect(first).toMatchObject({ actorId: ana.id, fromStage: null, toStage: "Triagem", note: null });
    const statusEvent = await prisma.requestStatusEvent.findFirstOrThrow({
      where: { requestId: request.id, toStatus: "IN_PROGRESS" },
    });
    expect(first.occurredAt.getTime()).toBe(statusEvent.occurredAt.getTime());
    await expect(
      prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id, type: "request.stage_changed" } }),
    ).resolves.toMatchObject({ payload: { stageEventId: first.id, direction: "start", actorId: ana.id } });

    // Renaming or removing stages later does not touch the copy.
    await prisma.serviceStage.updateMany({ where: { serviceId: service.id }, data: { isActive: false } });
    await expect(stored(request.id)).resolves.toMatchObject({ stageNamesSnapshot: ["Triagem", "Execução", "Testes"] });
  });

  it("advances, returns with a reason and completes only at the last stage (CA-FLX-05, 06)", async () => {
    const { ana, request } = await scenario();
    actAs(ana);
    await start(request.id);

    await expect(complete(request.id)).rejects.toBeInstanceOf(ConflictError);
    await advance(request.id);
    await advance(request.id);
    await expect(advance(request.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(goBack(request.id)).rejects.toBeInstanceOf(ValidationError);
    await goBack(request.id, "Falhou no teste de bancada");
    await expect(complete(request.id)).rejects.toBeInstanceOf(ConflictError);
    await advance(request.id);
    await complete(request.id);

    await expect(stored(request.id)).resolves.toMatchObject({ status: "COMPLETED", stageIndex: 2 });
    const events = await stageEvents(request.id);
    expect(events.map(({ fromStage, toStage, note }) => [fromStage, toStage, note])).toEqual([
      [null, "Triagem", null],
      ["Triagem", "Execução", null],
      ["Execução", "Testes", null],
      ["Testes", "Execução", "Falhou no teste de bancada"],
      ["Execução", "Testes", null],
    ]);
    const outbox = await prisma.outboxEvent.findMany({
      where: { requestId: request.id, type: "request.stage_changed" },
      orderBy: { occurredAt: "asc" },
    });
    expect(outbox.map(({ payload }) => (payload as { direction: string }).direction)).toEqual([
      "start",
      "advance",
      "advance",
      "return",
      "advance",
    ]);
    expect(JSON.stringify(outbox.map(({ payload }) => payload))).not.toContain("bancada");
  });

  it("lets only one of two simultaneous moves win, writing nothing for the other (CA-FLX-07)", async () => {
    const { ana, request } = await scenario();
    actAs(ana);
    await start(request.id);

    // Both people saw the first stage and clicked "advance".
    const click = () => moveRequestStage({ requestId: request.id, direction: "advance", fromStageIndex: 0 }, prisma);
    const results = await Promise.allSettled([click(), click()]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ConflictError);
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 1 });
    await expect(stageEvents(request.id)).resolves.toHaveLength(2);
  });

  it("lets only the assignee move a held request and hides it from outsiders (CA-FLX-07)", async () => {
    const { rita, ana, bia, caio, admin, request } = await scenario();
    actAs(ana);
    await assumeRequest({ requestId: request.id }, prisma);
    await start(request.id);

    actAs(bia);
    await expect(advance(request.id)).rejects.toBeInstanceOf(ConflictError);
    for (const outsider of [caio, rita, admin]) {
      actAs(outsider);
      await expect(advance(request.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 0 });

    actAs(ana);
    await advance(request.id);
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 1 });
  });

  it("clears the stage on reopening and copies the current flow on the next start (CA-FLX-09)", async () => {
    const { rita, ana, request, service } = await scenario(["Única"]);
    actAs(ana);
    await start(request.id);
    await complete(request.id);

    actAs(rita);
    await reopenRequest({ requestId: request.id, note: "Voltou o defeito" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ status: "OPEN", stageNamesSnapshot: [], stageIndex: null });

    await prisma.serviceStage.create({ data: { serviceId: service.id, name: "Revisão", position: 5 } });
    actAs(ana);
    await start(request.id);
    await expect(stored(request.id)).resolves.toMatchObject({ stageNamesSnapshot: ["Única", "Revisão"], stageIndex: 0 });
  });

  it("works exactly as before for a service without stages (CA-FLX-01)", async () => {
    const { ana, request } = await scenario([]);
    actAs(ana);

    await start(request.id);
    await expect(advance(request.id)).rejects.toBeInstanceOf(ConflictError);
    await complete(request.id);

    await expect(stored(request.id)).resolves.toMatchObject({ status: "COMPLETED", stageNamesSnapshot: [], stageIndex: null });
    await expect(stageEvents(request.id)).resolves.toHaveLength(0);
    await expect(
      prisma.outboxEvent.count({ where: { requestId: request.id, type: "request.stage_changed" } }),
    ).resolves.toBe(0);
  });
});
