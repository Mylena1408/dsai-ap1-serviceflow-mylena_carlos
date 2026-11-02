import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import {
  createDomainCategory,
  createDomainRequest,
  createDomainSector,
  createDomainService,
  createDomainUser,
} from "./domain-fixtures";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.5 (SF-095; CA-MAIL-09).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getEmailOverview } from "@/modules/notifications";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

const configured = { EMAIL_API_KEY: "test-key-not-real", EMAIL_FROM: "avisos@exemplo.test", APP_BASE_URL: "https://sf.example" };

/** `count` deliveries for Rita, one minute apart, the last one sent. */
async function deliveries(count: number) {
  const sector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  const request = await createDomainRequest({ requesterId: rita.id, serviceId: service.id, sectorId: sector.id });
  const start = Date.UTC(2026, 10, 1, 8);
  for (let index = 0; index < count; index += 1) {
    const createdAt = new Date(start + index * 60_000);
    const notification = await prisma.requestNotification.create({
      data: { recipientId: rita.id, requestId: request.id, type: "status.IN_PROGRESS", createdAt },
    });
    const last = index === count - 1;
    await prisma.emailDelivery.create({
      data: {
        notificationId: notification.id,
        recipientId: rita.id,
        createdAt,
        availableAt: createdAt,
        status: last ? "SENT" : "SKIPPED",
        attempts: last ? 1 : 0,
        sentAt: last ? createdAt : null,
        lastErrorCode: last ? null : "not_configured",
      },
    });
  }
  return { rita, start };
}

describe("email follow-up for the administrator (SF-095; CA-MAIL-09)", () => {
  it("shows the configuration state and the 50 latest deliveries, without content", async () => {
    const { rita, start } = await deliveries(52);
    const admin = await createDomainUser({ role: "ADMIN" });
    actAs(admin);

    const overview = await getEmailOverview(prisma, {});
    expect(overview.configured).toBe(false);
    expect(overview.deliveries).toHaveLength(50);
    expect(overview.deliveries[0]).toEqual({
      id: expect.any(String),
      recipientName: rita.name,
      recipientEmail: rita.email,
      type: "status.IN_PROGRESS",
      status: "SENT",
      attempts: 1,
      createdAt: new Date(start + 51 * 60_000),
      sentAt: new Date(start + 51 * 60_000),
      lastErrorCode: null,
    });
    expect(overview.deliveries[49].createdAt).toEqual(new Date(start + 2 * 60_000));
    expect(overview.deliveries[1]).toMatchObject({ status: "SKIPPED", lastErrorCode: "not_configured" });

    await expect(getEmailOverview(prisma, configured)).resolves.toMatchObject({ configured: true });
    // Only the state is reported: no value of the variables leaves the server.
    expect(JSON.stringify(await getEmailOverview(prisma, configured))).not.toContain("test-key-not-real");
  });

  it("refuses everyone but the administrator", async () => {
    const sector = await createDomainSector();
    for (const role of ["REQUESTER", "ATTENDANT", "MANAGER"] as const) {
      actAs(await createDomainUser({ role, sectorId: role === "REQUESTER" ? null : sector.id }));
      await expect(getEmailOverview(prisma, configured)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});
