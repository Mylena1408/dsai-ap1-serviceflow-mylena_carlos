import { describe, expect, it, vi } from "vitest";
import type { Role, User } from "@prisma/client";
import { prisma } from "./fixtures";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-permissoes-configuraveis, sections 5.2 and 5.4 (SF-088; CA-PER-02, 03 and 04).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import {
  grantPermission,
  hasPermissionInSector,
  isPermissionEffective,
  listPermissionOverview,
  revokePermission,
} from "@/modules/permissions";

function actAs(user: Pick<User, "id" | "name" | "role" | "sectorId" | "isActive">) {
  session.getCurrentUser.mockResolvedValue({ ...user, email: `${user.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const admin = await createDomainUser({ role: "ADMIN" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  return { sector, admin, ana, gabi, rita };
}

const grantsOf = (userId: string) =>
  prisma.userPermission.findMany({ where: { userId }, select: { permission: true }, orderBy: { permission: "asc" } });

describe("permission grants (SF-088)", () => {
  it("grants once and revokes, recording who did it and when (CA-PER-02, 03)", async () => {
    const { admin, ana } = await scenario();
    actAs(admin);

    await grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
    await grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
    await grantPermission({ userId: ana.id, permission: "QUEUE_SUPERVISION" }, prisma);
    await expect(grantsOf(ana.id)).resolves.toEqual([{ permission: "SECTOR_SERVICES" }, { permission: "QUEUE_SUPERVISION" }]);

    await revokePermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
    await revokePermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);
    await expect(grantsOf(ana.id)).resolves.toEqual([{ permission: "QUEUE_SUPERVISION" }]);

    const { events } = await listPermissionOverview(prisma);
    expect(events.map(({ permission, action, actor }) => [permission, action, actor.id])).toEqual([
      ["SECTOR_SERVICES", "REVOKED", admin.id],
      ["QUEUE_SUPERVISION", "GRANTED", admin.id],
      ["SECTOR_SERVICES", "GRANTED", admin.id],
    ]);
  });

  it("refuses ineligible profiles, inactive users and unknown users (CA-PER-02)", async () => {
    const { admin, ana, gabi, rita } = await scenario();
    actAs(admin);

    await expect(grantPermission({ userId: gabi.id, permission: "QUEUE_SUPERVISION" }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(grantPermission({ userId: ana.id, permission: "SECTOR_REQUESTS_READ" }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(grantPermission({ userId: rita.id, permission: "SECTOR_SERVICES" }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(grantPermission({ userId: admin.id, permission: "SECTOR_SERVICES" }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(grantPermission({ userId: ana.id, permission: "EVERYTHING" }, prisma)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await prisma.user.update({ where: { id: ana.id }, data: { isActive: false } });
    await expect(grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      grantPermission({ userId: crypto.randomUUID(), permission: "SECTOR_SERVICES" }, prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(prisma.userPermission.count()).resolves.toBe(0);
  });

  it("lets only the administrator see and change permissions (CA-PER-02)", async () => {
    const { ana, gabi, rita } = await scenario();

    for (const actor of [ana, gabi, rita] as Array<User & { role: Role }>) {
      actAs(actor);
      await expect(listPermissionOverview(prisma)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(revokePermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    }
  });

  it("follows the holder's current profile, state and sector (CA-PER-04)", async () => {
    const { admin, ana } = await scenario();
    const otherSector = await createDomainSector();
    actAs(admin);
    await grantPermission({ userId: ana.id, permission: "QUEUE_SUPERVISION" }, prisma);

    const holder = async () => prisma.user.findUniqueOrThrow({ where: { id: ana.id } });
    const granted = ["QUEUE_SUPERVISION" as const];

    expect(hasPermissionInSector(await holder(), granted, "QUEUE_SUPERVISION", ana.sectorId!)).toBe(true);
    await prisma.user.update({ where: { id: ana.id }, data: { sectorId: otherSector.id } });
    expect(hasPermissionInSector(await holder(), granted, "QUEUE_SUPERVISION", ana.sectorId!)).toBe(false);
    expect(hasPermissionInSector(await holder(), granted, "QUEUE_SUPERVISION", otherSector.id)).toBe(true);
    await prisma.user.update({ where: { id: ana.id }, data: { role: "MANAGER" } });
    expect(isPermissionEffective(await holder(), "QUEUE_SUPERVISION")).toBe(false);
    // The grant stays recorded, without effect, for the administrator to see.
    await expect(grantsOf(ana.id)).resolves.toEqual([{ permission: "QUEUE_SUPERVISION" }]);
  });
});
