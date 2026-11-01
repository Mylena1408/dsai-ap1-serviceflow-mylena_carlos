import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-01-permissoes-configuraveis, section 6 (SF-087).

describe("permission schema (SF-087)", () => {
  it("starts everybody without permissions (CA-PER-10)", async () => {
    await createDomainUser({ role: "REQUESTER" });

    await expect(prisma.userPermission.count()).resolves.toBe(0);
    await expect(prisma.userPermissionEvent.count()).resolves.toBe(0);
  });

  it("keeps one grant per user and permission, and records events", async () => {
    const sector = await createDomainSector();
    const admin = await createDomainUser({ role: "ADMIN" });
    const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const grant = () =>
      prisma.userPermission.create({
        data: { userId: attendant.id, permission: "SECTOR_SERVICES", grantedById: admin.id, grantedAt: new Date() },
      });

    await expect(grant()).resolves.toBeTruthy();
    await expect(grant()).rejects.toThrow();
    await expect(
      prisma.userPermission.create({
        data: { userId: attendant.id, permission: "QUEUE_SUPERVISION", grantedById: admin.id, grantedAt: new Date() },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.userPermissionEvent.create({
        data: { userId: attendant.id, permission: "SECTOR_SERVICES", action: "REVOKED", actorId: admin.id, occurredAt: new Date() },
      }),
    ).resolves.toBeTruthy();

    // Users with grants or history are kept (deactivated, never deleted).
    await expect(prisma.user.delete({ where: { id: attendant.id } })).rejects.toThrow();
  });
});
