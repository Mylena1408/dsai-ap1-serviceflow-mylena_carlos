import { describe, expect, it, vi } from "vitest";
import type { RequestStatus, Role } from "@prisma/client";
import { prisma } from "./fixtures";
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

import { changeRequestPriority, recordSlaAlerts } from "@/modules/requests";
import { runDailyJob } from "@/server/jobs";

// SPEC 2026-11-01-sla-prioridades, section 5.5 (SF-069).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const HOUR = 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gone = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } });
  const caio = await createDomainUser({ role: "ATTENDANT", sectorId: otherSector.id });

  /** A request of the sector with a 10 h NORMAL SLA due `dueInMs` from now. */
  async function add(dueInMs: number, extra: { assigneeId?: string; status?: RequestStatus } = {}) {
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    return prisma.request.update({
      where: { id: request.id },
      data: {
        slaHoursSnapshot: 10,
        dueAt: new Date(Date.now() + dueInMs),
        assigneeId: extra.assigneeId ?? null,
        ...(extra.status ? { status: extra.status } : {}),
      },
    });
  }

  return { rita, ana, bia, gone, caio, add };
}

const alertEvents = (requestId: string) =>
  prisma.outboxEvent.findMany({
    where: { requestId, type: { in: ["request.sla_warning", "request.sla_breached"] } },
    orderBy: { occurredAt: "asc" },
  });

const recipients = async (requestId: string, type: string) =>
  (await prisma.requestNotification.findMany({ where: { requestId, type } })).map(({ recipientId }) => recipientId).sort();

describe("SLA alerts of the daily job (CA-SLA-07)", () => {
  it("alerts once per situation and notifies the assignee", async () => {
    const { ana, add } = await scenario();
    const request = await add(HOUR, { assigneeId: ana.id });

    const first = await runDailyJob();
    expect(first.slaAlerts).toEqual({ status: "ok", result: { warnings: 1, breaches: 0 } });
    await runDailyJob();
    await expect(alertEvents(request.id)).resolves.toHaveLength(1);
    await expect(recipients(request.id, "sla.warning")).resolves.toEqual([ana.id]);

    // The due date passes: one breach alert, then nothing more.
    await prisma.request.update({ where: { id: request.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await expect(recordSlaAlerts(new Date(), prisma)).resolves.toEqual({ warnings: 0, breaches: 1 });
    await expect(recordSlaAlerts(new Date(), prisma)).resolves.toEqual({ warnings: 0, breaches: 0 });
    await runDailyJob();
    expect((await alertEvents(request.id)).map(({ type }) => type)).toEqual(["request.sla_warning", "request.sla_breached"]);
    await expect(recipients(request.id, "sla.breached")).resolves.toEqual([ana.id]);
  });

  it("notifies the active attendants of the sector when nobody holds the request", async () => {
    const { ana, bia, add } = await scenario();
    const request = await add(-HOUR);

    await runDailyJob();

    // Found already overdue: only the breach alert, and the warning is closed too.
    expect((await alertEvents(request.id)).map(({ type }) => type)).toEqual(["request.sla_breached"]);
    await expect(prisma.request.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      slaWarningNotifiedAt: expect.any(Date),
      slaBreachNotifiedAt: expect.any(Date),
    });
    await expect(recipients(request.id, "sla.breached")).resolves.toEqual([ana.id, bia.id].sort());
  });

  it("skips requests on time, finished or without SLA, and alerts again after a later due date", async () => {
    const { ana, add } = await scenario();
    const onTime = await add(5 * HOUR);
    const completed = await add(-HOUR, { status: "COMPLETED" });
    await prisma.request.update({ where: { id: completed.id }, data: { completedAt: new Date(), completedLate: true } });
    const moved = await add(HOUR, { assigneeId: ana.id });

    await expect(recordSlaAlerts(new Date(), prisma)).resolves.toEqual({ warnings: 1, breaches: 0 });
    await expect(alertEvents(onTime.id)).resolves.toHaveLength(0);
    await expect(alertEvents(completed.id)).resolves.toHaveLength(0);

    // LOW doubles the SLA: the due date moves later and the warning can be sent again.
    actAs(ana);
    await changeRequestPriority({ requestId: moved.id, priority: "LOW" }, prisma);
    await prisma.request.update({ where: { id: moved.id }, data: { dueAt: new Date(Date.now() + HOUR) } });
    await expect(recordSlaAlerts(new Date(), prisma)).resolves.toEqual({ warnings: 1, breaches: 0 });
    await expect(alertEvents(moved.id)).resolves.toHaveLength(2);
  });

  it("notifies nobody when the request finished before the event was processed", async () => {
    const { ana, add } = await scenario();
    const request = await add(HOUR, { assigneeId: ana.id });
    await recordSlaAlerts(new Date(), prisma);
    await prisma.request.update({
      where: { id: request.id },
      data: { status: "COMPLETED", completedAt: new Date(), completedLate: false },
    });

    await runDailyJob();

    await expect(prisma.requestNotification.count({ where: { requestId: request.id } })).resolves.toBe(0);
  });
});
