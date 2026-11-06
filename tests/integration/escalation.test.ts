import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainRequest, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getAnalytics } from "@/modules/reports";
import { listRequestEscalations } from "@/modules/requests";
import { setSectorEscalation } from "@/modules/sectors";
import { runDailyJob } from "@/server/jobs";
import { AuthorizationError, NotFoundError } from "@/server/errors";

// SPEC 2026-11-06-escalonamento over the database (SF-154 and SF-155; CA-ESC-01 to 07).

type Actor = { id: string; name: string; email: string; role: Role; sectorId: string | null };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, isActive: true });
const HOUR = 3_600_000;

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const away = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  await prisma.user.update({ where: { id: away.id }, data: { isActive: false } });
  const admin = await createDomainUser({ role: "ADMIN" });

  /** An overdue request (due one hour ago) with an assignee. */
  async function overdue(priority: "LOW" | "NORMAL" | "HIGH" | "URGENT" = "NORMAL", extra: Record<string, unknown> = {}) {
    const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
    return prisma.request.update({
      where: { id: request.id },
      data: { slaHoursSnapshot: 10, priority, dueAt: new Date(Date.now() - HOUR), assigneeId: ana.id, ...extra },
    });
  }

  return { sector, rita, ana, gabi, away, admin, overdue };
}

const notified = async (requestId: string, type: string) =>
  (await prisma.requestNotification.findMany({ where: { requestId, type } })).map(({ recipientId }) => recipientId).sort();

describe("escalation of overdue requests (CA-ESC-01 to 04)", () => {
  it("does nothing more than the breach alert while the sector's setting is off", async () => {
    const { ana, overdue } = await scenario();
    const request = await overdue("NORMAL");
    await runDailyJob();

    const after = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
    expect(after).toMatchObject({ priority: "NORMAL", dueAt: request.dueAt });
    expect(after.slaBreachNotifiedAt).not.toBeNull();
    await expect(prisma.requestEscalation.count({ where: { requestId: request.id } })).resolves.toBe(0);
    expect(await notified(request.id, "sla.breached")).toEqual([ana.id]);
    expect(await notified(request.id, "sla.escalated")).toEqual([]);
  });

  it("raises the priority, keeps the due date and warns the active managers when the setting is on", async () => {
    const { sector, ana, gabi, admin, overdue } = await scenario();
    actAs(admin);
    await setSectorEscalation(sector.id, true, prisma);
    const normal = await overdue("NORMAL");
    const urgent = await overdue("URGENT");
    await runDailyJob();

    const raised = await prisma.request.findUniqueOrThrow({ where: { id: normal.id } });
    expect(raised).toMatchObject({ priority: "HIGH", dueAt: normal.dueAt });
    expect(await prisma.requestEscalation.findMany({ where: { requestId: normal.id }, select: { fromPriority: true, toPriority: true } })).toEqual([
      { fromPriority: "NORMAL", toPriority: "HIGH" },
    ]);
    // Already urgent: recorded, priority kept.
    expect((await prisma.request.findUniqueOrThrow({ where: { id: urgent.id } })).priority).toBe("URGENT");
    expect(await prisma.requestEscalation.findMany({ where: { requestId: urgent.id }, select: { fromPriority: true, toPriority: true } })).toEqual([
      { fromPriority: "URGENT", toPriority: "URGENT" },
    ]);
    // The breach recipients stay; only the active manager hears about the escalation.
    expect(await notified(normal.id, "sla.breached")).toEqual([ana.id]);
    expect(await notified(normal.id, "sla.escalated")).toEqual([gabi.id]);

    // A second run escalates nothing more.
    await runDailyJob();
    await expect(prisma.requestEscalation.count({ where: { requestId: normal.id } })).resolves.toBe(1);
  });

  it("does not escalate a paused request, and escalates again after a new due date", async () => {
    const { sector, admin, overdue } = await scenario();
    actAs(admin);
    await setSectorEscalation(sector.id, true, prisma);
    const paused = await overdue("LOW", { status: "IN_PROGRESS", slaPausedAt: new Date() });
    const request = await overdue("LOW");
    await runDailyJob();
    await expect(prisma.requestEscalation.count({ where: { requestId: paused.id } })).resolves.toBe(0);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: paused.id } })).priority).toBe("LOW");

    // A reopening brings a new due date and clears the alert marks (SPEC de SLA, 5.3).
    await prisma.request.update({
      where: { id: request.id },
      data: { dueAt: new Date(Date.now() - HOUR / 2), slaWarningNotifiedAt: null, slaBreachNotifiedAt: null },
    });
    await runDailyJob();
    expect(
      (await prisma.requestEscalation.findMany({ where: { requestId: request.id }, orderBy: { occurredAt: "asc" }, select: { fromPriority: true, toPriority: true } })),
    ).toEqual([
      { fromPriority: "LOW", toPriority: "NORMAL" },
      { fromPriority: "NORMAL", toPriority: "HIGH" },
    ]);
  });
});

describe("setting, reading and analytics (CA-ESC-05 to 07)", () => {
  it("lets only the administrator change the setting, audited as a sector change", async () => {
    const { sector, gabi, admin } = await scenario();
    actAs(gabi);
    await expect(setSectorEscalation(sector.id, true, prisma)).rejects.toThrow(AuthorizationError);
    actAs(admin);
    await setSectorEscalation(sector.id, true, prisma);
    await setSectorEscalation(sector.id, false, prisma);
    expect((await prisma.sector.findUniqueOrThrow({ where: { id: sector.id } })).escalateOverdue).toBe(false);
    await expect(prisma.auditEntry.count({ where: { entityType: "SECTOR", entityId: sector.id, action: "UPDATED" } })).resolves.toBe(2);
  });

  it("shows the escalations to the team and the reading manager, never to the requester, and counts them", async () => {
    const { sector, rita, ana, gabi, admin, overdue } = await scenario();
    await prisma.userPermission.create({ data: { userId: gabi.id, permission: "SECTOR_REQUESTS_READ", grantedById: admin.id, grantedAt: new Date() } });
    actAs(admin);
    await setSectorEscalation(sector.id, true, prisma);
    const request = await overdue("NORMAL");
    await runDailyJob();

    for (const reader of [ana, gabi]) {
      actAs(reader);
      expect(await listRequestEscalations(request.id, prisma)).toEqual([expect.objectContaining({ fromPriority: "NORMAL", toPriority: "HIGH" })]);
    }
    // The requester reads the request, but the page never asks for this block; a stranger is refused.
    const stranger = await createDomainUser({ role: "ATTENDANT", sectorId: (await createDomainSector()).id });
    actAs(stranger);
    await expect(listRequestEscalations(request.id, prisma)).rejects.toThrow(NotFoundError);
    void rita;

    actAs(admin);
    expect((await getAnalytics({ period: "7", sector: sector.id }, prisma)).sla.escalated).toBe(1);
  });
});
