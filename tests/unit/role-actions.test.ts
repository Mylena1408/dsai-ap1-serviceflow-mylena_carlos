import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3 (SF-172): actions of the roles and of the ends.

const permissions = vi.hoisted(() => ({
  grantPermission: vi.fn(),
  revokePermission: vi.fn(),
  assignAccessRole: vi.fn(),
  removeAccessRole: vi.fn(),
  createAccessRole: vi.fn(),
  updateAccessRole: vi.fn(),
  setAccessRoleActive: vi.fn(),
}));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/permissions", () => permissions);
vi.mock("@/modules/users", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assignRoleAction, grantPermissionAction, removeRoleAction } from "@/app/(admin)/admin/_sections/users/actions";
import { createRoleAction, toggleRoleAction, updateRoleAction } from "@/app/(admin)/admin/_sections/roles/actions";

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const endRefused = new ValidationError([{ path: ["expiresOn"], code: "too_big" }]);

describe("grants with an end (6.3.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(permissions)) fn.mockResolvedValue(undefined);
  });

  it("sends the end of the form and reports a refused end apart", async () => {
    const values = { userId: "u", permission: "QUEUE_SUPERVISION", section: "users", expiresOn: "2026-12-01" };
    await expect(grantPermissionAction(form(values))).rejects.toThrow("REDIRECT:/admin?section=users&notice=updated&entity=permissions");
    expect(permissions.grantPermission).toHaveBeenCalledWith({ userId: "u", permission: "QUEUE_SUPERVISION", expiresOn: "2026-12-01" });

    permissions.grantPermission.mockRejectedValueOnce(endRefused);
    await expect(grantPermissionAction(form(values))).rejects.toThrow("REDIRECT:/admin?section=users&error=validation&entity=permissionValidity");
  });
});

describe("role assignments (6.3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(permissions)) fn.mockResolvedValue(undefined);
  });

  it("assigns with the end and removes", async () => {
    await expect(assignRoleAction(form({ userId: "u", roleId: "r", expiresOn: "", section: "users" }))).rejects.toThrow(
      "REDIRECT:/admin?section=users&notice=updated&entity=roleAssignments",
    );
    expect(permissions.assignAccessRole).toHaveBeenCalledWith({ userId: "u", roleId: "r", expiresOn: "" });
    await expect(removeRoleAction(form({ userId: "u", roleId: "r", section: "users" }))).rejects.toThrow(
      "REDIRECT:/admin?section=users&notice=updated&entity=roleAssignments",
    );
    expect(permissions.removeAccessRole).toHaveBeenCalledWith({ userId: "u", roleId: "r" });
  });

  it("reports a refused end, an ineligible profile and an inactive role", async () => {
    const values = { userId: "u", roleId: "r", expiresOn: "2030-01-01", section: "users" };
    permissions.assignAccessRole.mockRejectedValueOnce(endRefused);
    await expect(assignRoleAction(form(values))).rejects.toThrow("error=validation&entity=roleValidity");
    permissions.assignAccessRole.mockRejectedValueOnce(new ValidationError([{ path: ["roleId"], code: "invalid_value" }]));
    await expect(assignRoleAction(form(values))).rejects.toThrow("error=validation&entity=roleAssignments");
    permissions.assignAccessRole.mockRejectedValueOnce(new ConflictError());
    await expect(assignRoleAction(form(values))).rejects.toThrow("error=dependency&entity=roleAssignments");
  });
});

describe("roles section actions (6.3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(permissions)) fn.mockResolvedValue(undefined);
  });

  it("creates and edits with every checked permission", async () => {
    const values = { name: "Supervisão", description: "", permissions: ["SECTOR_SERVICES", "QUEUE_SUPERVISION"] };
    await expect(createRoleAction(form(values))).rejects.toThrow("REDIRECT:/admin?section=roles&notice=created&entity=roles");
    expect(permissions.createAccessRole).toHaveBeenCalledWith(values);
    await expect(updateRoleAction(form({ id: "r", ...values }))).rejects.toThrow("REDIRECT:/admin?section=roles&notice=updated&entity=roles");
    expect(permissions.updateAccessRole).toHaveBeenCalledWith("r", values);
  });

  it("deactivates and reports a repeated name", async () => {
    await expect(toggleRoleAction(form({ id: "r", isActive: "false" }))).rejects.toThrow("REDIRECT:/admin?section=roles&notice=status&entity=roles");
    expect(permissions.setAccessRoleActive).toHaveBeenCalledWith("r", false);
    permissions.createAccessRole.mockRejectedValueOnce(new ConflictError());
    await expect(createRoleAction(form({ name: "x", permissions: ["SECTOR_SERVICES"] }))).rejects.toThrow(
      "REDIRECT:/admin?section=roles&error=dependency&entity=roles",
    );
  });
});
