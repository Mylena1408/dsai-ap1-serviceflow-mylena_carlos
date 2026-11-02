import { describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-02-auditoria-lgpd, 5.3 (SF-105; CA-AUD-05): the daily job removes what passed its
// deadline, reports how much, and keeps everything still inside it.

vi.mock("@/server/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { runDailyJob } from "@/server/jobs";

const now = new Date("2026-11-02T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, extraMs = 0) => new Date(now.getTime() - days * DAY - extraMs);

async function scenario() {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });

  const notification = (createdAt: Date, readAt: Date | null) =>
    prisma.requestNotification.create({
      data: { recipientId: rita.id, requestId: request.id, type: "status.IN_PROGRESS", createdAt, readAt },
    });
  const delivery = async (createdAt: Date) => {
    // A recent, read notification: only the delivery is old.
    const owner = await notification(now, now);
    return prisma.emailDelivery.create({
      data: { notificationId: owner.id, recipientId: rita.id, createdAt, availableAt: createdAt, status: "SKIPPED" },
    });
  };
  const audit = (occurredAt: Date) =>
    prisma.auditEntry.create({
      data: {
        actorId: "admin-from-server-session",
        actorRole: "ADMIN",
        action: "UPDATED",
        entityType: "SECTOR",
        entityId: sector.id,
        entityLabel: sector.name,
        occurredAt,
      },
    });

  return {
    request,
    oldUnread: await notification(ago(365, 1), null),
    keptUnread: await notification(ago(364), null),
    // Read notifications keep their own 90-day rule, counted from the reading.
    oldReadButRecentlyRead: await notification(ago(400), ago(10)),
    oldDelivery: await delivery(ago(180, 1)),
    keptDelivery: await delivery(ago(179)),
    oldAudit: await audit(new Date("2021-11-02T14:59:59.999Z")),
    keptAudit: await audit(new Date("2021-11-02T15:00:00.000Z")),
  };
}

describe("retention in the daily job (SF-105; CA-AUD-05)", () => {
  it("removes unread notifications, deliveries and audit entries past their deadline and reports it", async () => {
    const data = await scenario();

    const summary = await runDailyJob(now);

    expect(summary.purgedUnreadNotifications).toEqual({ status: "ok", result: 1 });
    expect(summary.purgedEmailDeliveries).toEqual({ status: "ok", result: 1 });
    expect(summary.purgedAuditEntries).toEqual({ status: "ok", result: 1 });

    await expect(prisma.requestNotification.findUnique({ where: { id: data.oldUnread.id } })).resolves.toBeNull();
    await expect(prisma.requestNotification.findUnique({ where: { id: data.keptUnread.id } })).resolves.not.toBeNull();
    await expect(prisma.requestNotification.findUnique({ where: { id: data.oldReadButRecentlyRead.id } })).resolves.not.toBeNull();
    await expect(prisma.emailDelivery.findUnique({ where: { id: data.oldDelivery.id } })).resolves.toBeNull();
    await expect(prisma.emailDelivery.findUnique({ where: { id: data.keptDelivery.id } })).resolves.not.toBeNull();
    await expect(prisma.auditEntry.findUnique({ where: { id: data.oldAudit.id } })).resolves.toBeNull();
    await expect(prisma.auditEntry.findUnique({ where: { id: data.keptAudit.id } })).resolves.not.toBeNull();
  });

  it("never removes requests, whatever their age", async () => {
    const { request } = await scenario();
    await prisma.request.update({ where: { id: request.id }, data: { createdAt: ago(3650), status: "COMPLETED", completedAt: ago(3600) } });

    await runDailyJob(now);

    await expect(prisma.request.findUnique({ where: { id: request.id } })).resolves.not.toBeNull();
  });

  it("removes nothing when everything is inside its deadline", async () => {
    await scenario();
    await runDailyJob(now);

    const second = await runDailyJob(now);

    expect(second.purgedUnreadNotifications).toEqual({ status: "ok", result: 0 });
    expect(second.purgedEmailDeliveries).toEqual({ status: "ok", result: 0 });
    expect(second.purgedAuditEntries).toEqual({ status: "ok", result: 0 });
  });
});
