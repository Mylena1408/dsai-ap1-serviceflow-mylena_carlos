import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-notificacoes-email-preferencias, section 6 (SF-092; CA-MAIL-10).

async function notificationFor(recipientId: string) {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const request = await createDomainRequest({ requesterId: recipientId, serviceId: service.id, sectorId: sector.id });
  return prisma.requestNotification.create({
    data: { recipientId, requestId: request.id, type: "status.IN_PROGRESS", createdAt: new Date() },
  });
}

describe("email notification schema (SF-092)", () => {
  it("starts everybody with email off and no deliveries (CA-MAIL-10)", async () => {
    await createDomainUser({ role: "REQUESTER" });

    await expect(prisma.notificationPreference.count()).resolves.toBe(0);
    await expect(prisma.emailDelivery.count()).resolves.toBe(0);
  });

  it("keeps one preference per user and category", async () => {
    const user = await createDomainUser({ role: "REQUESTER" });
    const prefer = () =>
      prisma.notificationPreference.create({ data: { userId: user.id, category: "SLA", emailEnabled: true, updatedAt: new Date() } });

    await expect(prefer()).resolves.toMatchObject({ category: "SLA", emailEnabled: true });
    await expect(prefer()).rejects.toThrow();
    await expect(
      prisma.notificationPreference.create({ data: { userId: user.id, category: "STATUS", emailEnabled: false, updatedAt: new Date() } }),
    ).resolves.toBeTruthy();
  });

  it("keeps one pending delivery per notification, removed with the notification", async () => {
    const user = await createDomainUser({ role: "REQUESTER" });
    const notification = await notificationFor(user.id);
    const deliver = () =>
      prisma.emailDelivery.create({
        data: { notificationId: notification.id, recipientId: user.id, availableAt: new Date(), createdAt: new Date() },
      });

    await expect(deliver()).resolves.toMatchObject({ status: "PENDING", attempts: 0, sentAt: null, lastErrorCode: null });
    await expect(deliver()).rejects.toThrow();

    // The daily cleanup purges read notifications; their deliveries go with them.
    await prisma.requestNotification.delete({ where: { id: notification.id } });
    await expect(prisma.emailDelivery.count({ where: { notificationId: notification.id } })).resolves.toBe(0);
  });
});
