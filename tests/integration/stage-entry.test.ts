import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { configureServiceStage, createServiceStage } from "@/modules/service-stages";
import { createService } from "@/modules/services";
import { assumeRequest, createRequest, getAttendantRequest, moveRequestStage, recordStageDeadlineAlerts, transitionRequestStatus } from "@/modules/requests";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.1 and 5.3.2 (SF-169; CA-ETP-03 and 04).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const DAY = 24 * 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

const settings = (input: Partial<{ assigneeId: string | null; targetDays: number | null }>) => ({
  assigneeId: null,
  targetDays: null,
  conditionFieldId: null,
  conditionValue: null,
  ...input,
});

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  actAs(admin);
  const service = await createService({ name: `Reparo ${sector.id}`, description: "Reparo", categoryId: category.id, sectorId: sector.id }, prisma);
  const triage = await createServiceStage(service.id, { name: "Triagem" }, prisma);
  const bench = await createServiceStage(service.id, { name: "Bancada" }, prisma);
  const tests = await createServiceStage(service.id, { name: "Testes" }, prisma);
  return { sector, admin, rita, ana, bia, caio, service, triage, bench, tests };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const notificationsOf = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" }, select: { type: true } });
async function move(requestId: string, direction: "advance" | "return", note?: string) {
  const { stageIndex } = await stored(requestId);
  return moveRequestStage({ requestId, direction, fromStageIndex: stageIndex ?? 0, note }, prisma);
}

async function started(context: Awaited<ReturnType<typeof scenario>>) {
  actAs(context.rita);
  const request = await createRequest({ serviceId: context.service.id, description: "Notebook" }, prisma);
  actAs(context.ana);
  await assumeRequest({ requestId: request.id }, prisma);
  await transitionRequestStatus({ requestId: request.id, toStatus: "IN_PROGRESS" }, prisma);
  return request;
}

describe("entering a stage (SF-169)", () => {
  it("hands the request to the stage's attendant, with history, event and notification (CA-ETP-03)", async () => {
    const context = await scenario();
    const { admin, ana, bia, bench } = context;
    actAs(admin);
    await configureServiceStage(bench.id, settings({ assigneeId: bia.id }), prisma);
    const request = await started(context);

    actAs(ana);
    await move(request.id, "advance");
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 1, assigneeId: bia.id });
    const transfer = await prisma.requestAssignmentEvent.findFirstOrThrow({ where: { requestId: request.id, toAssigneeId: bia.id } });
    expect(transfer).toMatchObject({ actorId: ana.id, fromAssigneeId: ana.id });
    await process();
    await expect(notificationsOf(bia.id)).resolves.toEqual([{ type: "assignment.received" }]);

    // Now Bia holds it: she moves on; "Testes" has no attendant, so she keeps it.
    actAs(bia);
    await move(request.id, "advance");
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 2, assigneeId: bia.id });
    // Going back to "Bancada" while Bia already holds it changes nothing.
    await move(request.id, "return", "Falhou no teste");
    await expect(prisma.requestAssignmentEvent.count({ where: { requestId: request.id, toAssigneeId: bia.id } })).resolves.toBe(1);
  });

  it("keeps the assignee and records it when the stage's attendant is no longer available (CA-ETP-03)", async () => {
    const context = await scenario();
    const { admin, ana, bia, bench } = context;
    actAs(admin);
    await configureServiceStage(bench.id, settings({ assigneeId: bia.id }), prisma);
    const request = await started(context);
    await prisma.user.update({ where: { id: bia.id }, data: { isActive: false } });

    actAs(ana);
    await move(request.id, "advance");
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 1, assigneeId: ana.id });
    const entry = await prisma.requestStageEvent.findFirstOrThrow({ where: { requestId: request.id, toStage: "Bancada" } });
    expect(entry.assigneeUnavailable).toBe(true);
    const detail = await getAttendantRequest(request.id, prisma);
    expect(detail.stageEvents.find(({ toStage }) => toStage === "Bancada")).toMatchObject({ assigneeUnavailable: true });
  });

  it("hands the first stage to its attendant when the attendance starts", async () => {
    const context = await scenario();
    const { admin, triage, bia } = context;
    actAs(admin);
    await configureServiceStage(triage.id, settings({ assigneeId: bia.id }), prisma);
    const request = await started(context);
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 0, assigneeId: bia.id });
  });

  it("gives each stage entered its own due date, without changing the SLA (CA-ETP-04)", async () => {
    const context = await scenario();
    const { admin, ana, triage, bench } = context;
    actAs(admin);
    await configureServiceStage(triage.id, settings({ targetDays: 1 }), prisma);
    await configureServiceStage(bench.id, settings({ targetDays: 3 }), prisma);
    const request = await started(context);
    const first = await stored(request.id);
    expect(first.stageDueAt!.getTime() - first.updatedAt.getTime()).toBe(DAY);

    actAs(ana);
    await move(request.id, "advance");
    const second = await stored(request.id);
    expect(second.stageDueAt!.getTime() - second.updatedAt.getTime()).toBe(3 * DAY);
    expect(second.dueAt).toEqual(first.dueAt);
    await move(request.id, "advance");
    await expect(stored(request.id)).resolves.toMatchObject({ stageIndex: 2, stageDueAt: null });
  });

  it("announces a late stage once, to its holder, even while paused (CA-ETP-04, decision G12)", async () => {
    const context = await scenario();
    const { admin, ana, bia, caio, triage } = context;
    actAs(admin);
    await configureServiceStage(triage.id, settings({ targetDays: 1 }), prisma);
    const request = await started(context);
    await expect(recordStageDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 0 });

    // The outbox delivers only events whose time has come: the due date moves to the past.
    // A paused SLA needs an SLA: the request gets one before the pause.
    await prisma.request.update({
      where: { id: request.id },
      data: {
        slaHoursSnapshot: 24,
        dueAt: new Date(Date.now() + DAY),
        slaPausedAt: new Date(),
        stageDueAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(recordStageDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 1 });
    await expect(recordStageDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 0 });
    await process();
    await expect(notificationsOf(ana.id)).resolves.toEqual([{ type: "stage.overdue" }]);
    await expect(notificationsOf(bia.id)).resolves.toEqual([]);
    await expect(notificationsOf(caio.id)).resolves.toEqual([]);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id, type: "request.stage_overdue" } });
    expect(event.payload).toEqual({ stageIndex: 0 });
  });

  it("announces a late stage of a request nobody holds to the sector's team", async () => {
    const context = await scenario();
    const { admin, ana, bia, caio, triage } = context;
    actAs(admin);
    await configureServiceStage(triage.id, settings({ targetDays: 1 }), prisma);
    const request = await started(context);
    await prisma.request.update({ where: { id: request.id }, data: { assigneeId: null, stageDueAt: new Date(Date.now() - 60_000) } });
    await recordStageDeadlineAlerts(new Date(), prisma);
    await process();
    for (const person of [ana, bia, caio]) {
      await expect(notificationsOf(person.id)).resolves.toEqual([{ type: "stage.overdue" }]);
    }
  });
});
