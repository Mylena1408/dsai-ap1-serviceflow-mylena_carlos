import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { listNotifications, notificationConsumer } from "@/modules/notifications";
import {
  createRequest,
  getAttendantRequest,
  getRequesterRequest,
  moveRequestStage,
  searchAttendantQueue,
  transitionRequestStatus,
} from "@/modules/requests";

// SPEC 2026-11-01-fluxos-configuraveis, sections 5.5 and 5.6 (SF-079; CA-FLX-08 and 10).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  for (const [position, name] of ["Triagem", "Execução", "Testes"].entries()) {
    await prisma.serviceStage.create({ data: { serviceId: service.id, name, position } });
  }
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(rita);
  const request = await createRequest({ serviceId: service.id, description: "Ar-condicionado pingando" }, prisma);
  return { service, rita, ana, request };
}

const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const stageNotifications = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId, type: "stage.changed" }, orderBy: { createdAt: "asc" } });

describe("stage notifications and history (SF-079)", () => {
  it("notifies the requester of each move, but not of the first stage, with the stage name (CA-FLX-08)", async () => {
    const { rita, ana, request } = await scenario();

    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await process();
    await expect(stageNotifications(rita.id)).resolves.toHaveLength(0);

    await moveRequestStage({ requestId: request.id, direction: "advance", fromStageIndex: 0 }, prisma);
    await moveRequestStage({ requestId: request.id, direction: "return", fromStageIndex: 1, note: "Faltou a peça" }, prisma);
    await process();

    await expect(stageNotifications(rita.id)).resolves.toHaveLength(2);
    await expect(stageNotifications(ana.id)).resolves.toHaveLength(0);

    actAs(rita);
    const listed = await listNotifications(prisma);
    expect(listed.filter(({ type }) => type === "stage.changed").map(({ stageName }) => stageName)).toEqual([
      "Triagem",
      "Execução",
    ]);
    // Other notifications carry no stage name.
    expect(listed.filter(({ type }) => type !== "stage.changed").every((item) => !("stageName" in item))).toBe(true);
  });

  it("keeps the notification without the stage name once the event is purged", async () => {
    const { rita, ana, request } = await scenario();
    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await moveRequestStage({ requestId: request.id, direction: "advance", fromStageIndex: 0 }, prisma);
    await process();

    await prisma.outboxEvent.deleteMany({ where: { requestId: request.id } });

    actAs(rita);
    const [stage] = (await listNotifications(prisma)).filter(({ type }) => type === "stage.changed");
    expect(stage).toBeDefined();
    expect(stage.stageName).toBeUndefined();
  });

  it("returns the copy, the current stage and the stage history in the details and the queue (CA-FLX-10)", async () => {
    const { rita, ana, request } = await scenario();
    actAs(ana);
    await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
    await moveRequestStage({ requestId: request.id, direction: "advance", fromStageIndex: 0 }, prisma);

    const detail = await getAttendantRequest(request.id, prisma);
    expect(detail).toMatchObject({ stageNamesSnapshot: ["Triagem", "Execução", "Testes"], stageIndex: 1 });
    expect(detail.stageEvents.map(({ fromStage, toStage, actor }) => [fromStage, toStage, actor.id])).toEqual([
      [null, "Triagem", ana.id],
      ["Triagem", "Execução", ana.id],
    ]);
    const queue = await searchAttendantQueue({}, prisma);
    expect(queue.items.find(({ id }) => id === request.id)).toMatchObject({ stageIndex: 1 });

    actAs(rita);
    await expect(getRequesterRequest(request.id, prisma)).resolves.toMatchObject({ stageIndex: 1 });
  });
});
