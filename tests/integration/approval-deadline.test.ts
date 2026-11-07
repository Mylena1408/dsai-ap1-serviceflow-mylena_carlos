import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ValidationError } from "@/server/errors";
import { createDomainCategory, createDomainSector, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runOutbox } from "@/modules/events";
import { notificationConsumer } from "@/modules/notifications";
import { registerAbsence } from "@/modules/absences";
import { configureServiceApproval, createService } from "@/modules/services";
import { createRequest, decideApproval, recordApprovalDeadlineAlerts } from "@/modules/requests";
import { getAnalytics } from "@/modules/reports";
import { organizationToday } from "@/modules/requests/infrastructure/approval-coverage";
import { addDays } from "@/shared/time";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6 (SF-166; CA-APM-05 and part of CA-APM-07).

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const DAY = 24 * 60 * 60 * 1000;

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario(deadlineDays: number | null = 2) {
  const purchasing = await createDomainSector();
  const finance = await createDomainSector();
  const category = await createDomainCategory();
  const admin = await createDomainUser({ role: "ADMIN" });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: purchasing.id });
  const fred = await createDomainUser({ role: "MANAGER", sectorId: finance.id });
  actAs(admin);
  const service = await createService(
    { name: `Compra ${purchasing.id}`, description: "Compra", categoryId: category.id, sectorId: purchasing.id, slaHours: "10", requiresApproval: true },
    prisma,
  );
  await configureServiceApproval(
    service.id,
    { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null, deadlineDays },
    prisma,
  );
  return { purchasing, finance, admin, rita, gabi, fred, service };
}

const stored = (id: string) => prisma.request.findUniqueOrThrow({ where: { id } });
const process = () => runOutbox([notificationConsumer(prisma)], { maxBatches: 5 }, prisma);
const notificationsOf = (recipientId: string) =>
  prisma.requestNotification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" }, select: { type: true } });

describe("approval deadline (SF-166)", () => {
  it("gives each pending level a due date and starts the next one at the decision (CA-APM-05)", async () => {
    const { rita, gabi, fred, service } = await scenario(2);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    const opened = await stored(request.id);
    expect(opened.approvalDeadlineDaysSnapshot).toBe(2);
    expect(opened.approvalDueAt!.getTime() - opened.createdAt.getTime()).toBe(2 * DAY);

    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    const second = await stored(request.id);
    expect(second.approvalLevel).toBe(2);
    expect(second.approvalDueAt!.getTime() - second.updatedAt.getTime()).toBe(2 * DAY);
    const firstDecision = await prisma.requestApproval.findFirstOrThrow({ where: { requestId: request.id, level: 1 } });
    expect(firstDecision.dueAt).toEqual(opened.approvalDueAt);

    actAs(fred);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalState: "APPROVED", approvalDueAt: null, approvalOverdueNotifiedAt: null });
  });

  it("has no due date without a deadline, and keeps the copy when the service changes", async () => {
    const { purchasing, finance, admin, rita, service } = await scenario(null);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalDeadlineDaysSnapshot: null, approvalDueAt: null });

    actAs(admin);
    await configureServiceApproval(service.id, { sectorIds: [purchasing.id, finance.id], conditionFieldId: null, conditionValue: null, deadlineDays: 5 }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalDeadlineDaysSnapshot: null });
    // Omitting the deadline keeps it; null removes it; outside 1 to 30 is refused.
    await configureServiceApproval(service.id, { sectorIds: [], conditionFieldId: null, conditionValue: null }, prisma);
    await expect(prisma.service.findUniqueOrThrow({ where: { id: service.id } })).resolves.toMatchObject({ approvalDeadlineDays: 5 });
    await expect(
      configureServiceApproval(service.id, { sectorIds: [], conditionFieldId: null, conditionValue: null, deadlineDays: 31 }, prisma),
    ).rejects.toThrow(ValidationError);
    await configureServiceApproval(service.id, { sectorIds: [], conditionFieldId: null, conditionValue: null, deadlineDays: null }, prisma);
    await expect(prisma.service.findUniqueOrThrow({ where: { id: service.id } })).resolves.toMatchObject({ approvalDeadlineDays: null });
  });

  it("announces a late level once to its managers and today's substitutes, and decides nothing (CA-APM-05)", async () => {
    const { finance, rita, gabi, fred, service } = await scenario(1);
    const substitute = await createDomainUser({ role: "MANAGER", sectorId: finance.id });
    actAs(gabi);
    const day = (await organizationToday(prisma)).toISOString().slice(0, 10);
    await registerAbsence({ substituteId: substitute.id, startsOn: day, endsOn: addDays(day, 3) }, prisma);
    actAs(rita);
    const request = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    // Not late yet: the due date is tomorrow.
    await expect(recordApprovalDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 0 });

    // The outbox only delivers events whose time has come, as in the real job: the due date moves to
    // the past instead of the clock to the future.
    const makeLate = () => prisma.request.update({ where: { id: request.id }, data: { approvalDueAt: new Date(Date.now() - 60_000) } });
    await makeLate();
    const late = new Date();
    await expect(recordApprovalDeadlineAlerts(late, prisma)).resolves.toEqual({ overdue: 1 });
    await expect(recordApprovalDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 0 });
    await expect(stored(request.id)).resolves.toMatchObject({ approvalState: "PENDING", approvalLevel: 1, approvalOverdueNotifiedAt: late });

    await process();
    await expect(notificationsOf(gabi.id)).resolves.toEqual([{ type: "approval.requested" }, { type: "approval.overdue" }]);
    await expect(notificationsOf(substitute.id)).resolves.toEqual([{ type: "approval.requested" }, { type: "approval.overdue" }]);
    await expect(notificationsOf(fred.id)).resolves.toEqual([]);
    await expect(notificationsOf(rita.id)).resolves.toEqual([]);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { requestId: request.id, type: "request.approval_overdue" } });
    expect(event.payload).toEqual({ level: 1, sectorId: (await stored(request.id)).approvalPendingSectorId });

    // The next level gets its own deadline and its own announcement.
    actAs(gabi);
    await decideApproval({ requestId: request.id, decision: "APPROVED", note: "" }, prisma);
    await expect(stored(request.id)).resolves.toMatchObject({ approvalLevel: 2, approvalOverdueNotifiedAt: null });
    await expect(recordApprovalDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 0 });
    await makeLate();
    await expect(recordApprovalDeadlineAlerts(new Date(), prisma)).resolves.toEqual({ overdue: 1 });
    await process();
    await expect(notificationsOf(fred.id)).resolves.toEqual([{ type: "approval.requested" }, { type: "approval.overdue" }]);
  });

  it("counts the late levels in the analytics of the period (CA-APM-07)", async () => {
    const { purchasing, admin, rita, gabi, service } = await scenario(1);
    actAs(rita);
    const decidedLate = await createRequest({ serviceId: service.id, description: "Notebook" }, prisma);
    const stillLate = await createRequest({ serviceId: service.id, description: "Monitor" }, prisma);
    const onTime = await createRequest({ serviceId: service.id, description: "Mouse" }, prisma);
    // Move the first two due dates to the past; the third keeps tomorrow's.
    const past = new Date(Date.now() - 2 * DAY);
    await prisma.request.updateMany({ where: { id: { in: [decidedLate.id, stillLate.id] } }, data: { approvalDueAt: past } });
    actAs(gabi);
    await decideApproval({ requestId: decidedLate.id, decision: "APPROVED", note: "" }, prisma);
    await decideApproval({ requestId: onTime.id, decision: "APPROVED", note: "" }, prisma);

    actAs(admin);
    const analytics = await getAnalytics({ period: "30d", sector: purchasing.id }, prisma);
    expect(analytics.sla.overdueApprovals).toBe(2);
  });
});
