import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, ValidationError } from "@/server/errors";
import { createDomainSector, createDomainUser } from "./domain-fixtures";
import { createMemoryDocumentStorage } from "@/server/storage";
import { zonedDayOf } from "@/shared/time";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3 and 6.4 (SF-171; CA-PAP-01, 03, 04 and 06,
// and the rules of CA-PAP-02 and 05 below the screens).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { actorHasPermission, loadEffectivePermissions } from "@/server/authorization";
import { organizationToday } from "@/server/authorization/effective-permissions";
import {
  assignAccessRole,
  createAccessRole,
  grantPermission,
  listAccessRoleOverview,
  listPermissionOverview,
  removeAccessRole,
  setAccessRoleActive,
  updateAccessRole,
} from "@/modules/permissions";
import { anonymizeUser, setUserActive } from "@/modules/users";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };

function actAs(actor: Actor) {
  session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });
}

async function scenario() {
  const sector = await createDomainSector();
  const admin = await createDomainUser({ role: "ADMIN" });
  const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const gabi = await createDomainUser({ role: "MANAGER", sectorId: sector.id });
  actAs(admin);
  return { sector, admin, ana, gabi };
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function shiftDay(value: string, amount: number): string {
  const date = day(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

describe("access role schema (6.4; CA-PAP-06)", () => {
  it("starts empty and keeps every existing grant without an end", async () => {
    const { admin, ana } = await scenario();
    await expect(prisma.accessRole.count()).resolves.toBe(0);
    await prisma.userPermission.create({ data: { userId: ana.id, permission: "SECTOR_SERVICES", grantedById: admin.id, grantedAt: new Date() } });
    await expect(prisma.userPermission.findFirstOrThrow({ where: { userId: ana.id } })).resolves.toMatchObject({ expiresOn: null });
  });

  it("refuses names and descriptions out of shape and 0 or repeated permissions", async () => {
    const valid = { name: "Supervisão", permissions: ["QUEUE_SUPERVISION" as const] };
    for (const data of [
      { ...valid, name: " Supervisão" },
      { ...valid, name: "" },
      { ...valid, name: "x".repeat(61) },
      { ...valid, description: "" },
      { ...valid, description: " texto" },
      { ...valid, description: "x".repeat(201) },
      { ...valid, permissions: [] },
      { ...valid, permissions: ["QUEUE_SUPERVISION" as const, "QUEUE_SUPERVISION" as const] },
    ]) {
      await expect(prisma.accessRole.create({ data })).rejects.toThrow(/AccessRole_values_check/);
    }
    await expect(
      prisma.$executeRaw`INSERT INTO "AccessRole" ("id", "name", "permissions", "updatedAt") VALUES (gen_random_uuid(), 'Nulo', NULL, now())`,
    ).rejects.toThrow(/AccessRole_values_check/);
    await expect(
      prisma.accessRole.create({ data: { name: "x".repeat(60), description: "y".repeat(200), permissions: ["SECTOR_SERVICES", "SECTOR_REQUESTS_READ", "QUEUE_SUPERVISION"] } }),
    ).resolves.toMatchObject({ isActive: true });
  });

  it("keeps names unique among the active roles, ignoring case", async () => {
    await prisma.accessRole.create({ data: { name: "Supervisão", permissions: ["QUEUE_SUPERVISION"] } });
    await expect(prisma.accessRole.create({ data: { name: "SUPERVISÃO", permissions: ["SECTOR_SERVICES"] } })).rejects.toThrow(
      /AccessRole_name_active_key|Unique constraint/,
    );
    await expect(
      prisma.accessRole.create({ data: { name: "supervisão", permissions: ["SECTOR_SERVICES"], isActive: false } }),
    ).resolves.toMatchObject({ isActive: false });
  });
});

describe("roles configured by the administrator (6.3.1 and 6.3.3)", () => {
  it("creates, edits, deactivates and reactivates with the audit trail", async () => {
    const { admin } = await scenario();
    const role = await createAccessRole({ name: "Supervisão", description: "Turno da noite", permissions: ["QUEUE_SUPERVISION", "SECTOR_SERVICES"] }, prisma);
    expect(role).toMatchObject({ name: "Supervisão", permissions: ["SECTOR_SERVICES", "QUEUE_SUPERVISION"], isActive: true });

    await updateAccessRole(role.id, { name: "Supervisão da fila", permissions: ["QUEUE_SUPERVISION"] }, prisma);
    await setAccessRoleActive(role.id, false, prisma);
    await setAccessRoleActive(role.id, false, prisma);
    await setAccessRoleActive(role.id, true, prisma);

    const entries = await prisma.auditEntry.findMany({ where: { entityType: "ACCESS_ROLE", entityId: role.id }, orderBy: { occurredAt: "asc" } });
    expect(entries.map(({ action, actorId }) => [action, actorId])).toEqual([
      ["CREATED", admin.id],
      ["UPDATED", admin.id],
      ["DEACTIVATED", admin.id],
      ["REACTIVATED", admin.id],
    ]);
    expect(entries[1]).toMatchObject({ entityLabel: "Supervisão da fila" });
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "name", before: "Supervisão", after: "Supervisão da fila" },
        { field: "description", before: "Turno da noite", after: null },
        { field: "permissions", before: ["SECTOR_SERVICES", "QUEUE_SUPERVISION"], after: ["QUEUE_SUPERVISION"] },
      ]),
    );
  });

  it("refuses a repeated active name, also on reactivation, and a role without permissions", async () => {
    await scenario();
    const first = await createAccessRole({ name: "Catálogo", permissions: ["SECTOR_SERVICES"] }, prisma);
    await expect(createAccessRole({ name: "catálogo", permissions: ["SECTOR_SERVICES"] }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await setAccessRoleActive(first.id, false, prisma);
    await createAccessRole({ name: "Catálogo", permissions: ["SECTOR_SERVICES"] }, prisma);
    await expect(setAccessRoleActive(first.id, true, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(createAccessRole({ name: "Vazio", permissions: [] }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await expect(prisma.accessRole.count()).resolves.toBe(2);
  });
});

describe("effective permissions: grants and roles (6.3.1; CA-PAP-01 and 03)", () => {
  it("without roles or ends, the permissions are the grants, as before", async () => {
    const { ana } = await scenario();
    await grantPermission({ userId: ana.id, permission: "QUEUE_SUPERVISION" }, prisma);
    await expect(loadEffectivePermissions(prisma, ana.id)).resolves.toEqual(["QUEUE_SUPERVISION"]);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(true);
    await expect(actorHasPermission(ana, "SECTOR_SERVICES")).resolves.toBe(false);
  });

  it("adds the active roles' permissions, filtered by profile, and removes them on the next operation", async () => {
    const { ana, gabi } = await scenario();
    const role = await createAccessRole({ name: "Supervisão", permissions: ["QUEUE_SUPERVISION", "SECTOR_SERVICES"] }, prisma);
    await grantPermission({ userId: ana.id, permission: "SECTOR_SERVICES" }, prisma);

    await assignAccessRole({ userId: ana.id, roleId: role.id }, prisma);
    await assignAccessRole({ userId: gabi.id, roleId: role.id }, prisma);
    await expect(loadEffectivePermissions(prisma, ana.id)).resolves.toEqual(["SECTOR_SERVICES", "QUEUE_SUPERVISION"]);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(true);
    // The profile rule stays: a manager never supervises the queue, even through a role.
    await expect(actorHasPermission(gabi, "QUEUE_SUPERVISION")).resolves.toBe(false);
    await expect(actorHasPermission(gabi, "SECTOR_SERVICES")).resolves.toBe(true);

    await setAccessRoleActive(role.id, false, prisma);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(false);
    await expect(actorHasPermission(ana, "SECTOR_SERVICES")).resolves.toBe(true); // the individual grant
    await expect(prisma.userAccessRole.count({ where: { roleId: role.id } })).resolves.toBe(2);

    await setAccessRoleActive(role.id, true, prisma);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(true);
    await removeAccessRole({ userId: ana.id, roleId: role.id }, prisma);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(false);
  });

  it("refuses a role the profile cannot use and a deactivated role", async () => {
    const { gabi, ana } = await scenario();
    const queue = await createAccessRole({ name: "Fila", permissions: ["QUEUE_SUPERVISION"] }, prisma);
    await expect(assignAccessRole({ userId: gabi.id, roleId: queue.id }, prisma)).rejects.toBeInstanceOf(ValidationError);
    await setAccessRoleActive(queue.id, false, prisma);
    await expect(assignAccessRole({ userId: ana.id, roleId: queue.id }, prisma)).rejects.toBeInstanceOf(ConflictError);
    await expect(prisma.userAccessRole.count()).resolves.toBe(0);
  });
});

describe("validity (6.3.2; CA-PAP-04)", () => {
  it("counts through the last day and stops after it, without a job", async () => {
    const { ana } = await scenario();
    const today = await organizationToday(prisma);
    const role = await createAccessRole({ name: "Catálogo", permissions: ["SECTOR_SERVICES"] }, prisma);
    await grantPermission({ userId: ana.id, permission: "QUEUE_SUPERVISION", expiresOn: today }, prisma);
    await assignAccessRole({ userId: ana.id, roleId: role.id, expiresOn: today }, prisma);
    await expect(loadEffectivePermissions(prisma, ana.id)).resolves.toEqual(["SECTOR_SERVICES", "QUEUE_SUPERVISION"]);

    // The day passes: the ends move to yesterday, as the clock would do.
    const yesterday = day(shiftDay(today, -1));
    await prisma.userPermission.updateMany({ where: { userId: ana.id }, data: { expiresOn: yesterday } });
    await prisma.userAccessRole.updateMany({ where: { userId: ana.id }, data: { expiresOn: yesterday } });
    await expect(loadEffectivePermissions(prisma, ana.id)).resolves.toEqual([]);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(false);

    // Renewing is granting again with a new end.
    await grantPermission({ userId: ana.id, permission: "QUEUE_SUPERVISION", expiresOn: shiftDay(today, 30) }, prisma);
    await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(true);
    const overview = await listPermissionOverview(prisma);
    expect(overview.today).toBe(today);
    expect(overview.grants).toEqual([expect.objectContaining({ permission: "QUEUE_SUPERVISION", expiresOn: shiftDay(today, 30) })]);
    expect(overview.events.map(({ action, expiresOn }) => [action, expiresOn])).toEqual([
      ["GRANTED", shiftDay(today, 30)],
      ["GRANTED", today],
    ]);
  });

  it("refuses an end in the past or beyond 365 days", async () => {
    const { ana } = await scenario();
    const today = await organizationToday(prisma);
    const role = await createAccessRole({ name: "Catálogo", permissions: ["SECTOR_SERVICES"] }, prisma);
    for (const expiresOn of [shiftDay(today, -1), shiftDay(today, 366)]) {
      await expect(grantPermission({ userId: ana.id, permission: "QUEUE_SUPERVISION", expiresOn }, prisma)).rejects.toBeInstanceOf(ValidationError);
      await expect(assignAccessRole({ userId: ana.id, roleId: role.id, expiresOn }, prisma)).rejects.toBeInstanceOf(ValidationError);
    }
    await assignAccessRole({ userId: ana.id, roleId: role.id, expiresOn: shiftDay(today, 365) }, prisma);
    await expect(prisma.userPermission.count()).resolves.toBe(0);
  });

  it("ends the day in the organization's time zone", async () => {
    const { ana } = await scenario();
    // UTC+14 and UTC-11 are always on different calendar days.
    const now = new Date();
    const behind = zonedDayOf(now, "Pacific/Pago_Pago");
    await prisma.userPermission.create({
      data: { userId: ana.id, permission: "QUEUE_SUPERVISION", grantedById: ana.id, grantedAt: now, expiresOn: day(behind) },
    });
    const calendar = { weekdays: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1080 };
    try {
      await prisma.businessCalendar.create({ data: { id: 1, ...calendar, timeZone: "Pacific/Pago_Pago" } });
      await expect(organizationToday(prisma)).resolves.toBe(behind);
      await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(true);
      await prisma.businessCalendar.update({ where: { id: 1 }, data: { timeZone: "Pacific/Kiritimati" } });
      await expect(organizationToday(prisma)).resolves.toBe(zonedDayOf(new Date(), "Pacific/Kiritimati"));
      await expect(actorHasPermission(ana, "QUEUE_SUPERVISION")).resolves.toBe(false);
    } finally {
      await prisma.businessCalendar.deleteMany();
    }
  });
});

describe("history of the roles (6.3.3)", () => {
  it("records assignment, renewal and removal with who, when and the end", async () => {
    const { admin, ana } = await scenario();
    const today = await organizationToday(prisma);
    const role = await createAccessRole({ name: "Catálogo", permissions: ["SECTOR_SERVICES"] }, prisma);
    await assignAccessRole({ userId: ana.id, roleId: role.id, expiresOn: shiftDay(today, 10) }, prisma);
    await assignAccessRole({ userId: ana.id, roleId: role.id, expiresOn: shiftDay(today, 10) }, prisma);
    await assignAccessRole({ userId: ana.id, roleId: role.id, expiresOn: "" }, prisma);
    await removeAccessRole({ userId: ana.id, roleId: role.id }, prisma);
    await removeAccessRole({ userId: ana.id, roleId: role.id }, prisma);

    const overview = await listAccessRoleOverview(prisma);
    expect(overview.roles).toEqual([expect.objectContaining({ id: role.id, assignmentCount: 0 })]);
    expect(overview.assignments).toEqual([]);
    expect(overview.events.map(({ action, expiresOn, actor, role: { name } }) => [action, expiresOn, actor.id, name])).toEqual([
      ["REVOKED", null, admin.id, "Catálogo"],
      ["GRANTED", null, admin.id, "Catálogo"],
      ["GRANTED", shiftDay(today, 10), admin.id, "Catálogo"],
    ]);
  });

  it("anonymization removes the roles too, with the history", async () => {
    const { admin, ana } = await scenario();
    const role = await createAccessRole({ name: "Catálogo", permissions: ["SECTOR_SERVICES"] }, prisma);
    await assignAccessRole({ userId: ana.id, roleId: role.id }, prisma);
    await setUserActive(ana.id, false, prisma);
    await anonymizeUser({ userId: ana.id, confirmed: true }, prisma, createMemoryDocumentStorage());

    await expect(prisma.userAccessRole.count({ where: { userId: ana.id } })).resolves.toBe(0);
    await expect(prisma.userAccessRoleEvent.findMany({ where: { userId: ana.id }, orderBy: { occurredAt: "desc" } })).resolves.toEqual([
      expect.objectContaining({ action: "REVOKED", actorId: admin.id, roleId: role.id }),
      expect.objectContaining({ action: "GRANTED" }),
    ]);
  });
});
