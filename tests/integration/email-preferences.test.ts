import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError } from "@/server/errors";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-notificacoes-email-preferencias, 5.1 and 5.6 (SF-093; CA-MAIL-03).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { getEmailPreferences, updateEmailPreferences } from "@/modules/notifications";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

const off = { STATUS: false, ASSIGNMENT: false, COMMENTS: false, SLA: false, STAGES: false, APPROVALS: false };

describe("email preferences (SF-093; CA-MAIL-03)", () => {
  it("keeps each person's choice apart, starting with everything off", async () => {
    const sector = await createDomainSector();
    const rita = await createDomainUser({ role: "REQUESTER" });
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });

    for (const person of [rita, ana, gabi]) {
      actAs(person);
      await expect(getEmailPreferences(prisma)).resolves.toEqual(off);
    }

    actAs(rita);
    await updateEmailPreferences({ categories: ["STATUS", "COMMENTS"] }, prisma);
    actAs(gabi);
    await updateEmailPreferences({ categories: ["APPROVALS"] }, prisma);

    actAs(rita);
    await expect(getEmailPreferences(prisma)).resolves.toEqual({ ...off, STATUS: true, COMMENTS: true });
    actAs(ana);
    await expect(getEmailPreferences(prisma)).resolves.toEqual(off);
    actAs(gabi);
    await expect(getEmailPreferences(prisma)).resolves.toEqual({ ...off, APPROVALS: true });

    // Turning a category off keeps the row, now off.
    actAs(rita);
    await updateEmailPreferences({ categories: ["COMMENTS"] }, prisma);
    await expect(getEmailPreferences(prisma)).resolves.toEqual({ ...off, COMMENTS: true });
    await expect(prisma.notificationPreference.count({ where: { userId: rita.id } })).resolves.toBe(6);
    await expect(
      prisma.notificationPreference.findUniqueOrThrow({ where: { userId_category: { userId: rita.id, category: "STATUS" } } }),
    ).resolves.toMatchObject({ emailEnabled: false });
  });

  it("refuses the administrator", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    actAs(admin);

    await expect(getEmailPreferences(prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateEmailPreferences({ categories: ["SLA"] }, prisma)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(prisma.notificationPreference.count()).resolves.toBe(0);
  });
});
