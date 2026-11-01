import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";
import {
  PERMISSIONS,
  assertCanGrantPermission,
  canReceivePermission,
  hasPermissionInSector,
  isPermissionEffective,
  type PermissionHolder,
} from "@/modules/permissions/domain/permission";

// SPEC 2026-11-01-permissoes-configuraveis, sections 5.1 to 5.3 (SF-087; rules of CA-PER-02 and 04).

const attendant: PermissionHolder = { role: "ATTENDANT", isActive: true, sectorId: "sector-1" };
const manager: PermissionHolder = { role: "MANAGER", isActive: true, sectorId: "sector-1" };

describe("who may receive each permission (SF-087)", () => {
  it("follows table 5.1", () => {
    expect(PERMISSIONS).toEqual(["SECTOR_SERVICES", "SECTOR_REQUESTS_READ", "QUEUE_SUPERVISION"]);
    expect(canReceivePermission("ATTENDANT", "SECTOR_SERVICES")).toBe(true);
    expect(canReceivePermission("MANAGER", "SECTOR_SERVICES")).toBe(true);
    expect(canReceivePermission("MANAGER", "SECTOR_REQUESTS_READ")).toBe(true);
    expect(canReceivePermission("ATTENDANT", "SECTOR_REQUESTS_READ")).toBe(false);
    expect(canReceivePermission("ATTENDANT", "QUEUE_SUPERVISION")).toBe(true);
    expect(canReceivePermission("MANAGER", "QUEUE_SUPERVISION")).toBe(false);
    for (const permission of PERMISSIONS) {
      expect(canReceivePermission("ADMIN", permission)).toBe(false);
      expect(canReceivePermission("REQUESTER", permission)).toBe(false);
    }
  });

  it("grants only to active users of an eligible profile (CA-PER-02)", () => {
    expect(() => assertCanGrantPermission(attendant, "QUEUE_SUPERVISION")).not.toThrow();
    expect(() => assertCanGrantPermission(manager, "QUEUE_SUPERVISION")).toThrow(ValidationError);
    expect(() => assertCanGrantPermission({ role: "REQUESTER", isActive: true, sectorId: null }, "SECTOR_SERVICES")).toThrow(
      ValidationError,
    );
    expect(() => assertCanGrantPermission({ ...attendant, isActive: false }, "SECTOR_SERVICES")).toThrow(ConflictError);
  });
});

describe("effective permissions (SF-087; CA-PER-04)", () => {
  it("counts a granted permission only in the holder's current sector", () => {
    expect(hasPermissionInSector(attendant, ["SECTOR_SERVICES"], "SECTOR_SERVICES", "sector-1")).toBe(true);
    expect(hasPermissionInSector(attendant, ["SECTOR_SERVICES"], "SECTOR_SERVICES", "sector-2")).toBe(false);
    expect(hasPermissionInSector(attendant, [], "SECTOR_SERVICES", "sector-1")).toBe(false);
  });

  it("stops counting when the holder is deactivated, loses the sector or changes to an ineligible profile", () => {
    expect(isPermissionEffective({ ...attendant, isActive: false }, "SECTOR_SERVICES")).toBe(false);
    expect(isPermissionEffective({ ...attendant, sectorId: null }, "SECTOR_SERVICES")).toBe(false);
    expect(isPermissionEffective({ ...attendant, role: "MANAGER" }, "QUEUE_SUPERVISION")).toBe(false);
    expect(isPermissionEffective({ ...attendant, role: "MANAGER" }, "SECTOR_SERVICES")).toBe(true);
    expect(
      hasPermissionInSector({ ...attendant, role: "REQUESTER", sectorId: null }, ["SECTOR_SERVICES"], "SECTOR_SERVICES", "sector-1"),
    ).toBe(false);
  });
});
