import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 items 2 to 5, over the database (SF-174;
// CA-ESR-01 and 03 to 06).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnalytics } from "@/modules/reports";
import { applyEscalationRules, getAttendantRequest, listRequestEscalations } from "@/modules/requests";
import { createEscalationRule, setSectorEscalation } from "@/modules/sectors";
import { runDailyJob } from "@/server/jobs";

type Actor = { id: string; name: string; email: string; role: Role; sectorId: string | null };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, isActive: true });
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const hugo = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  actAs(admin);

  /** A request with `ana`, due `dueIn` milliseconds from now (negative: overdue). */
  async function dueIn(dueIn: number, extra: Record<string, unknown> = {}) {
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    return prisma.request.update({
      where: { id: request.id },
      data: { status: "IN_PROGRESS", slaHoursSnapshot: 10, priority: "NORMAL", dueAt: new Date(Date.now() + dueIn), assigneeId: ana.id, ...extra },
    });
  }

  const rule = (settings: Record<string, unknown>) => createEscalationRule({ sectorId: sector.id, ...settings }, prisma);
  return { sector, service, rita, ana, bia, gabi, hugo, admin, dueIn, rule };
}

const notified = async (requestId: string, type: string) =>
  (await prisma.requestNotification.findMany({ where: { requestId, type } })).map(({ recipientId }) => recipientId).sort();

describe("rules applied by the daily job (CA-ESR-03 and 04)", () => {
  it("'vencida há N dias' raises, hands over with the system as author and warns, once per due date", async () => {
    const { ana, bia, gabi, hugo, dueIn, rule } = await scenario();
    const atraso = await rule({ name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 1, raisePriority: true, assignToId: bia.id, notifyManagers: true, notifyUserIds: [ana.id] });
    const request = await dueIn(-DAY - HOUR);
    const early = await dueIn(-HOUR);

    const summary = await runDailyJob();
    expect(summary.escalationRules).toEqual({ status: "ok", result: { applied: 1, raised: 1, assigned: 1, warned: 3 } });

    const after = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
    expect(after).toMatchObject({ priority: "HIGH", assigneeId: bia.id, dueAt: request.dueAt });
    await expect(prisma.requestEscalation.findMany({ where: { requestId: request.id } })).resolves.toEqual([
      expect.objectContaining({
        trigger: "OVERDUE_DAYS",
        overdueDays: 1,
        ruleId: atraso.id,
        ruleName: "Atraso",
        dueAt: request.dueAt,
        fromPriority: "NORMAL",
        toPriority: "HIGH",
        assignedToId: bia.id,
        assignmentSkipped: false,
      }),
    ]);
    // G17: the handover has no author, is recorded and notified as a transfer.
    await expect(prisma.requestAssignmentEvent.findMany({ where: { requestId: request.id } })).resolves.toEqual([
      expect.objectContaining({ actorId: null, fromAssigneeId: ana.id, toAssigneeId: bia.id }),
    ]);
    expect(await notified(request.id, "assignment.received")).toEqual([bia.id]);
    expect(await notified(request.id, "sla.escalated")).toEqual([ana.id, gabi.id, hugo.id].sort());
    // One day has not passed for the other request.
    await expect(prisma.requestEscalation.count({ where: { requestId: early.id } })).resolves.toBe(0);

    // A second run applies nothing more; a new due date (a reopening) applies again.
    await runDailyJob();
    await expect(prisma.requestEscalation.count({ where: { requestId: request.id } })).resolves.toBe(1);
    await prisma.request.update({ where: { id: request.id }, data: { dueAt: new Date(Date.now() - DAY - 2 * HOUR) } });
    await runDailyJob();
    await expect(prisma.requestEscalation.count({ where: { requestId: request.id } })).resolves.toBe(2);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).priority).toBe("URGENT");
  });

  it("'próxima do vencimento' applies before the due date only, never during the pause or after the attendance", async () => {
    const { gabi, dueIn, rule } = await scenario();
    await rule({ name: "Perto", trigger: "DUE_SOON", notifyManagers: true });
    const soon = await dueIn(HOUR);
    const far = await dueIn(9 * HOUR);
    const late = await dueIn(-HOUR);
    const paused = await dueIn(HOUR, { slaPausedAt: new Date() });
    const done = await dueIn(HOUR, { status: "COMPLETED", completedAt: new Date() });

    await applyEscalationRules(new Date(), prisma);
    await expect(prisma.requestEscalation.findMany({ where: { requestId: soon.id } })).resolves.toEqual([
      expect.objectContaining({ trigger: "DUE_SOON", overdueDays: null, ruleName: "Perto", toPriority: "NORMAL", notifiedUserIds: expect.arrayContaining([gabi.id]) }),
    ]);
    for (const other of [far, late, paused, done]) {
      await expect(prisma.requestEscalation.count({ where: { requestId: other.id } })).resolves.toBe(0);
    }
  });

  it("skips and records an unavailable attendant, and applies a rule of the request's current sector only", async () => {
    const { ana, bia, dueIn, rule } = await scenario();
    await rule({ name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 1, assignToId: bia.id });
    await prisma.user.update({ where: { id: bia.id }, data: { isActive: false } });
    const request = await dueIn(-2 * DAY);
    const moved = await dueIn(-2 * DAY);
    await prisma.request.update({ where: { id: moved.id }, data: { sectorId: (await createDomainSector()).id } });

    await applyEscalationRules(new Date(), prisma);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).assigneeId).toBe(ana.id);
    await expect(prisma.requestEscalation.findMany({ where: { requestId: request.id } })).resolves.toEqual([
      expect.objectContaining({ assignedToId: null, assignmentSkipped: true, toPriority: "NORMAL" }),
    ]);
    await expect(prisma.requestAssignmentEvent.count({ where: { requestId: request.id } })).resolves.toBe(0);
    await expect(prisma.requestEscalation.count({ where: { requestId: moved.id } })).resolves.toBe(0);
  });

  it("two runs at once apply each rule once", async () => {
    const { dueIn, rule } = await scenario();
    await rule({ name: "Um dia", trigger: "OVERDUE_DAYS", overdueDays: 1, raisePriority: true });
    await rule({ name: "Dois dias", trigger: "OVERDUE_DAYS", overdueDays: 2, raisePriority: true });
    const request = await dueIn(-3 * DAY);
    const now = new Date();

    const results = await Promise.all([applyEscalationRules(now, prisma), applyEscalationRules(now, prisma), applyEscalationRules(now, prisma)]);
    expect(results.reduce((total, result) => total + result.applied, 0)).toBe(2);
    await expect(prisma.requestEscalation.count({ where: { requestId: request.id } })).resolves.toBe(2);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).priority).toBe("URGENT");
  });
});

describe("warnings (CA-ESR-05)", () => {
  it("each person once per run, by the 'Prazos' email preference; the option's managers only when the option escalated", async () => {
    const { bia, gabi, hugo, dueIn, rule } = await scenario();
    await rule({ name: "Um dia", trigger: "OVERDUE_DAYS", overdueDays: 1, notifyUserIds: [gabi.id, bia.id] });
    await rule({ name: "Dois dias", trigger: "OVERDUE_DAYS", overdueDays: 2, notifyUserIds: [gabi.id] });
    await prisma.notificationPreference.createMany({
      data: [
        { userId: gabi.id, category: "SLA", emailEnabled: false, updatedAt: new Date() },
        { userId: bia.id, category: "SLA", emailEnabled: true, updatedAt: new Date() },
      ],
    });
    const request = await dueIn(-3 * DAY);

    await runDailyJob();
    await expect(prisma.requestEscalation.count({ where: { requestId: request.id } })).resolves.toBe(2);
    expect(await notified(request.id, "sla.escalated")).toEqual([bia.id, gabi.id].sort());
    const deliveries = await prisma.emailDelivery.findMany({
      where: { notification: { requestId: request.id, type: "sla.escalated" } },
      select: { recipientId: true },
    });
    expect(deliveries.map(({ recipientId }) => recipientId)).toEqual([bia.id]);
    // The sector's option is off: the breach warns no manager as an escalation.
    expect(await notified(request.id, "sla.escalated")).not.toContain(hugo.id);
  });

  it("names the rule in the warning", async () => {
    const { gabi, dueIn, rule } = await scenario();
    await rule({ name: "Atraso grave", trigger: "OVERDUE_DAYS", overdueDays: 1, notifyUserIds: [gabi.id] });
    await dueIn(-2 * DAY);
    await runDailyJob();

    const { listNotifications } = await import("@/modules/notifications");
    actAs(gabi);
    const list = await listNotifications(prisma);
    expect(list).toEqual([expect.objectContaining({ type: "sla.escalated", ruleName: "Atraso grave" })]);
  });
});

describe("without rules, the detail and the analytics (CA-ESR-01 and 06)", () => {
  it("a sector without rules escalates as before, with or without the option", async () => {
    const { sector, gabi, hugo, dueIn } = await scenario();
    const off = await dueIn(-3 * DAY);
    await runDailyJob();
    await expect(prisma.requestEscalation.count({ where: { requestId: off.id } })).resolves.toBe(0);

    await setSectorEscalation(sector.id, true, prisma);
    const on = await dueIn(-3 * DAY);
    const summary = await runDailyJob();
    expect(summary.escalationRules).toEqual({ status: "ok", result: { applied: 0, raised: 0, assigned: 0, warned: 0 } });
    await expect(prisma.requestEscalation.findMany({ where: { requestId: on.id } })).resolves.toEqual([
      expect.objectContaining({ trigger: "OVERDUE", ruleId: null, notifiedUserIds: [] }),
    ]);
    expect(await notified(on.id, "sla.escalated")).toEqual([gabi.id, hugo.id].sort());
  });

  it("the detail shows each application and 'Análises' separates the triggers", async () => {
    const { sector, ana, bia, dueIn, rule, admin } = await scenario();
    await setSectorEscalation(sector.id, true, prisma);
    await rule({ name: "Atraso", trigger: "OVERDUE_DAYS", overdueDays: 1, raisePriority: true, assignToId: bia.id, notifyTeam: true });
    await rule({ name: "Perto", trigger: "DUE_SOON", notifyManagers: true });
    const late = await dueIn(-2 * DAY);
    const soon = await dueIn(HOUR);
    await runDailyJob();

    actAs({ ...ana, email: ana.email });
    const escalations = await listRequestEscalations(late.id, prisma);
    expect(escalations).toEqual([
      expect.objectContaining({ trigger: "OVERDUE", ruleName: null }),
      expect.objectContaining({
        trigger: "OVERDUE_DAYS",
        overdueDays: 1,
        ruleName: "Atraso",
        assignedTo: { id: bia.id, name: bia.name },
        assignmentSkipped: false,
        notifiedCount: 2,
      }),
    ]);
    // The history names the system as the author of the handover.
    actAs({ ...bia, email: bia.email });
    const detail = await getAttendantRequest(late.id, prisma);
    expect(detail.assignmentEvents).toEqual([expect.objectContaining({ actor: null, toAssignee: { id: bia.id, name: bia.name } })]);

    actAs(admin);
    const analytics = await getAnalytics({ period: "7", sector: sector.id }, prisma);
    expect(analytics.sla.escalated).toBe(1);
    expect(analytics.sla.escalatedByRule).toEqual({ dueSoon: 1, overdueDays: 1 });
    void soon;
  });
});
