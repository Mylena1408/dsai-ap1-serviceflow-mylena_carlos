import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  accessRoleInputSchema,
  assertCanAssignRole,
  orderedPermissions,
  receivablePermissions,
  roleAssignmentSchema,
  type AccessRoleRecord,
} from "@/modules/permissions/domain/access-role";
import { assertValidityEnd, isWithinValidity, validityEndSchema, validityLabel, validityState } from "@/modules/permissions/domain/validity";
import type { AccessRoleTransaction, PermissionTransaction } from "@/modules/permissions/application/ports";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  assignAccessRole,
  createAccessRole,
  removeAccessRole,
  setAccessRoleActive,
  updateAccessRole,
} from "@/modules/permissions/application/access-roles";
import { grantPermission, revokePermission } from "@/modules/permissions/application/permission-use-cases";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3 (SF-171; CA-PAP-02 to 04 by the rules).

const admin = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" as const, isActive: true, sectorId: null };
const userId = "11111111-1111-4111-8111-111111111111";
const roleId = "22222222-2222-4222-8222-222222222222";
const today = "2026-11-07";
const now = new Date("2026-11-07T15:00:00Z");

const role = (overrides: Partial<AccessRoleRecord> = {}): AccessRoleRecord => ({
  id: roleId,
  name: "Supervisão",
  description: null,
  permissions: ["QUEUE_SUPERVISION", "SECTOR_SERVICES"],
  isActive: true,
  ...overrides,
});

const attendant = { role: "ATTENDANT" as const, isActive: true, sectorId: "33333333-3333-4333-8333-333333333333" };

beforeEach(() => {
  authorization.requireConfigurationAdministrator.mockReset().mockResolvedValue(admin);
});

describe("validity end (6.3.2)", () => {
  it("reads blank as no end and refuses what is not a day", () => {
    expect(validityEndSchema.parse(undefined)).toBeNull();
    expect(validityEndSchema.parse(null)).toBeNull();
    expect(validityEndSchema.parse("  ")).toBeNull();
    expect(validityEndSchema.parse(" 2026-12-01 ")).toBe("2026-12-01");
    expect(validityEndSchema.safeParse("01/12/2026").success).toBe(false);
    expect(validityEndSchema.safeParse("2026-02-30").success).toBe(false);
  });

  it("accepts from today up to 365 days ahead", () => {
    expect(() => assertValidityEnd(null, today)).not.toThrow();
    expect(() => assertValidityEnd(today, today)).not.toThrow();
    expect(() => assertValidityEnd("2027-11-07", today)).not.toThrow();
    expect(() => assertValidityEnd("2026-11-06", today)).toThrow(ValidationError);
    expect(() => assertValidityEnd("2027-11-08", today)).toThrow(ValidationError);
  });

  it("counts through the last day and labels the state", () => {
    expect(isWithinValidity(null, today)).toBe(true);
    expect(isWithinValidity(today, today)).toBe(true);
    expect(isWithinValidity("2026-11-06", today)).toBe(false);
    expect(validityState(null, today)).toEqual({ kind: "none" });
    expect(validityState("2026-12-01", today)).toEqual({ kind: "active", until: "2026-12-01" });
    expect(validityState("2026-11-01", today)).toEqual({ kind: "ended", on: "2026-11-01" });
    expect(validityLabel("2026-12-01", today)).toBe("vence em 01/12/2026");
    expect(validityLabel("2026-11-01", today)).toBe("vencida em 01/11/2026");
    expect(validityLabel(null, today)).toBeNull();
  });
});

describe("role rules (6.3.1)", () => {
  it("validates name, description and 1 to 3 permissions without repetition", () => {
    expect(accessRoleInputSchema.parse({ name: " Supervisão ", description: "  ", permissions: ["QUEUE_SUPERVISION"] })).toEqual({
      name: "Supervisão",
      description: null,
      permissions: ["QUEUE_SUPERVISION"],
    });
    for (const input of [
      { name: "", permissions: ["QUEUE_SUPERVISION"] },
      { name: "x".repeat(61), permissions: ["QUEUE_SUPERVISION"] },
      { name: "R", description: "x".repeat(201), permissions: ["QUEUE_SUPERVISION"] },
      { name: "R", permissions: [] },
      { name: "R", permissions: ["QUEUE_SUPERVISION", "QUEUE_SUPERVISION"] },
      { name: "R", permissions: ["ADMIN"] },
      { name: "R", permissions: ["QUEUE_SUPERVISION"], extra: 1 },
    ]) {
      expect(accessRoleInputSchema.safeParse(input).success).toBe(false);
    }
    expect(accessRoleInputSchema.safeParse({ name: "x".repeat(60), description: "y".repeat(200), permissions: ["SECTOR_SERVICES"] }).success).toBe(true);
  });

  it("orders permissions as table 5.1 and keeps what the profile may receive", () => {
    expect(orderedPermissions(["QUEUE_SUPERVISION", "SECTOR_SERVICES"])).toEqual(["SECTOR_SERVICES", "QUEUE_SUPERVISION"]);
    expect(receivablePermissions(role(), { role: "ATTENDANT" })).toEqual(["SECTOR_SERVICES", "QUEUE_SUPERVISION"]);
    expect(receivablePermissions(role(), { role: "MANAGER" })).toEqual(["SECTOR_SERVICES"]);
    expect(receivablePermissions(role(), { role: "REQUESTER" })).toEqual([]);
  });

  it("assigns an active role to an active user whose profile receives something of it", () => {
    expect(() => assertCanAssignRole(attendant, role())).not.toThrow();
    expect(() => assertCanAssignRole({ ...attendant, role: "REQUESTER" }, role())).toThrow(ValidationError);
    expect(() => assertCanAssignRole({ ...attendant, role: "MANAGER" }, role({ permissions: ["QUEUE_SUPERVISION"] }))).toThrow(ValidationError);
    expect(() => assertCanAssignRole({ ...attendant, isActive: false }, role())).toThrow(ConflictError);
    expect(() => assertCanAssignRole(attendant, role({ isActive: false }))).toThrow(ConflictError);
    expect(roleAssignmentSchema.safeParse({ userId, roleId, expiresOn: "" })).toMatchObject({ success: true, data: { expiresOn: null } });
  });
});

function roleTransaction(state: { role?: AccessRoleRecord | null; holder?: typeof attendant | null; assignment?: { expiresOn: string | null } | null } = {}) {
  const current = state.role === undefined ? role() : state.role;
  const transaction: AccessRoleTransaction = {
    audited: vi.fn(async (_meta, change) => change()),
    currentTime: vi.fn(async () => now),
    today: vi.fn(async () => today),
    findRole: vi.fn(async () => current),
    createRole: vi.fn(async (input) => ({ id: roleId, isActive: true, ...input })),
    updateRole: vi.fn(async (_id, data) => ({ ...role(), ...data })),
    findHolder: vi.fn(async () => (state.holder === undefined ? attendant : state.holder)),
    findAssignment: vi.fn(async () => state.assignment ?? null),
    saveAssignment: vi.fn(async () => undefined),
    deleteAssignment: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => undefined),
  };
  return { transaction, runner: { run: <T>(work: (t: AccessRoleTransaction) => Promise<T>) => work(transaction) } };
}

describe("role use cases (6.3.1 and 6.3.3)", () => {
  it("only the administrator configures roles", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    const { runner, transaction } = roleTransaction();
    await expect(createAccessRole({ name: "R", permissions: ["SECTOR_SERVICES"] }, runner)).rejects.toThrow(AuthorizationError);
    await expect(assignAccessRole({ userId, roleId }, runner)).rejects.toThrow(AuthorizationError);
    expect(transaction.createRole).not.toHaveBeenCalled();
  });

  it("creates and edits with the audit trail, the permissions in table order", async () => {
    const { runner, transaction } = roleTransaction();
    await createAccessRole({ name: "Supervisão", permissions: ["QUEUE_SUPERVISION", "SECTOR_SERVICES"] }, runner);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATED", entityType: "ACCESS_ROLE" }), expect.any(Function));
    expect(transaction.createRole).toHaveBeenCalledWith({ name: "Supervisão", description: null, permissions: ["SECTOR_SERVICES", "QUEUE_SUPERVISION"] });

    await updateAccessRole(roleId, { name: "Supervisão da fila", description: "Turno", permissions: ["QUEUE_SUPERVISION"] }, runner);
    expect(transaction.audited).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "UPDATED", entityType: "ACCESS_ROLE", entityId: roleId }),
      expect.any(Function),
    );
    await expect(updateAccessRole(roleId, { name: "", permissions: ["QUEUE_SUPERVISION"] }, runner)).rejects.toThrow(ValidationError);
    await expect(updateAccessRole(roleId, { name: "R", permissions: ["QUEUE_SUPERVISION"] }, roleTransaction({ role: null }).runner)).rejects.toThrow(NotFoundError);
  });

  it("deactivates and reactivates with the audit, and does nothing when the state is the same", async () => {
    const { runner, transaction } = roleTransaction();
    await setAccessRoleActive(roleId, false, runner);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATED" }), expect.any(Function));
    expect(transaction.updateRole).toHaveBeenCalledWith(roleId, { isActive: false });

    const inactive = roleTransaction({ role: role({ isActive: false }) });
    await setAccessRoleActive(roleId, true, inactive.runner);
    expect(inactive.transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "REACTIVATED" }), expect.any(Function));

    const same = roleTransaction();
    await expect(setAccessRoleActive(roleId, true, same.runner)).resolves.toMatchObject({ isActive: true });
    expect(same.transaction.audited).not.toHaveBeenCalled();
  });

  it("assigns with the end, renews with another end and ignores the same assignment", async () => {
    const { runner, transaction } = roleTransaction();
    await assignAccessRole({ userId, roleId, expiresOn: "2026-12-01" }, runner);
    expect(transaction.saveAssignment).toHaveBeenCalledWith({ userId, roleId, assignedById: admin.id, assignedAt: now, expiresOn: "2026-12-01" });
    expect(transaction.insertEvent).toHaveBeenCalledWith({ userId, roleId, action: "GRANTED", actorId: admin.id, occurredAt: now, expiresOn: "2026-12-01" });

    const same = roleTransaction({ assignment: { expiresOn: "2026-12-01" } });
    await assignAccessRole({ userId, roleId, expiresOn: "2026-12-01" }, same.runner);
    expect(same.transaction.saveAssignment).not.toHaveBeenCalled();
    expect(same.transaction.insertEvent).not.toHaveBeenCalled();

    const renewed = roleTransaction({ assignment: { expiresOn: "2026-12-01" } });
    await assignAccessRole({ userId, roleId }, renewed.runner);
    expect(renewed.transaction.saveAssignment).toHaveBeenCalledWith(expect.objectContaining({ expiresOn: null }));
  });

  it("refuses an end in the past or beyond 365 days, a missing user or role and an ineligible profile", async () => {
    await expect(assignAccessRole({ userId, roleId, expiresOn: "2026-11-06" }, roleTransaction().runner)).rejects.toThrow(ValidationError);
    await expect(assignAccessRole({ userId, roleId, expiresOn: "2027-11-08" }, roleTransaction().runner)).rejects.toThrow(ValidationError);
    await expect(assignAccessRole({ userId, roleId }, roleTransaction({ holder: null }).runner)).rejects.toThrow(NotFoundError);
    await expect(assignAccessRole({ userId, roleId }, roleTransaction({ role: null }).runner)).rejects.toThrow(NotFoundError);
    await expect(assignAccessRole({ userId, roleId }, roleTransaction({ holder: { ...attendant, role: "REQUESTER" } as never }).runner)).rejects.toThrow(ValidationError);
    await expect(assignAccessRole({ userId, roleId }, roleTransaction({ role: role({ isActive: false }) }).runner)).rejects.toThrow(ConflictError);
  });

  it("removes with the history and ignores a role the user does not hold", async () => {
    const held = roleTransaction({ assignment: { expiresOn: null } });
    await removeAccessRole({ userId, roleId }, held.runner);
    expect(held.transaction.deleteAssignment).toHaveBeenCalledWith(userId, roleId);
    expect(held.transaction.insertEvent).toHaveBeenCalledWith({ userId, roleId, action: "REVOKED", actorId: admin.id, occurredAt: now, expiresOn: null });

    const none = roleTransaction();
    await removeAccessRole({ userId, roleId }, none.runner);
    expect(none.transaction.deleteAssignment).not.toHaveBeenCalled();
  });
});

function grantTransaction(grant: { expiresOn: string | null } | null = null) {
  const transaction: PermissionTransaction = {
    currentTime: vi.fn(async () => now),
    today: vi.fn(async () => today),
    findHolder: vi.fn(async () => attendant),
    findGrant: vi.fn(async () => grant),
    insertGrant: vi.fn(async () => undefined),
    renewGrant: vi.fn(async () => undefined),
    deleteGrant: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => undefined),
  };
  return { transaction, runner: { run: <T>(work: (t: PermissionTransaction) => Promise<T>) => work(transaction) } };
}

describe("individual grants with an end (6.3.2)", () => {
  it("grants with the end and records it in the history", async () => {
    const { runner, transaction } = grantTransaction();
    await grantPermission({ userId, permission: "QUEUE_SUPERVISION", expiresOn: "2026-11-30" }, runner);
    const grant = { userId, permission: "QUEUE_SUPERVISION", grantedById: admin.id, grantedAt: now, expiresOn: "2026-11-30" };
    expect(transaction.insertGrant).toHaveBeenCalledWith(grant);
    expect(transaction.insertEvent).toHaveBeenCalledWith({ userId, permission: "QUEUE_SUPERVISION", action: "GRANTED", actorId: admin.id, occurredAt: now, expiresOn: "2026-11-30" });
  });

  it("without an end works as before; the same grant again records nothing", async () => {
    const { runner, transaction } = grantTransaction();
    await grantPermission({ userId, permission: "QUEUE_SUPERVISION" }, runner);
    expect(transaction.insertGrant).toHaveBeenCalledWith(expect.objectContaining({ expiresOn: null }));

    const same = grantTransaction({ expiresOn: null });
    await grantPermission({ userId, permission: "QUEUE_SUPERVISION" }, same.runner);
    expect(same.transaction.insertEvent).not.toHaveBeenCalled();
  });

  it("renews an ended grant with a new end and refuses an end out of range", async () => {
    const ended = grantTransaction({ expiresOn: "2026-11-01" });
    await grantPermission({ userId, permission: "QUEUE_SUPERVISION", expiresOn: "2026-12-31" }, ended.runner);
    expect(ended.transaction.renewGrant).toHaveBeenCalledWith(expect.objectContaining({ expiresOn: "2026-12-31" }));
    expect(ended.transaction.insertGrant).not.toHaveBeenCalled();

    await expect(grantPermission({ userId, permission: "QUEUE_SUPERVISION", expiresOn: "2026-11-01" }, grantTransaction().runner)).rejects.toThrow(ValidationError);
    await expect(grantPermission({ userId, permission: "QUEUE_SUPERVISION", expiresOn: "2028-01-01" }, grantTransaction().runner)).rejects.toThrow(ValidationError);
  });

  it("revokes with an event without an end", async () => {
    const { runner, transaction } = grantTransaction({ expiresOn: "2026-11-30" });
    await revokePermission({ userId, permission: "QUEUE_SUPERVISION" }, runner);
    expect(transaction.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "REVOKED", expiresOn: null }));
  });
});
