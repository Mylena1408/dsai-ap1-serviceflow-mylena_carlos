import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/server/errors";

// SPEC 2026-11-01-permissoes-configuraveis, section 5.2 (SF-088): administrative actions.

const permissions = vi.hoisted(() => ({ grantPermission: vi.fn(), revokePermission: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/permissions", () => permissions);
vi.mock("@/modules/users", () => ({}));
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { grantPermissionAction, revokePermissionAction } from "@/app/(admin)/admin/_sections/users/actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("permission actions (SF-088)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.grantPermission.mockResolvedValue(undefined);
    permissions.revokePermission.mockResolvedValue(undefined);
  });

  it("grants and revokes for the user and permission in the form", async () => {
    const values = { userId: "user-1", permission: "SECTOR_SERVICES", section: "users" };

    await expect(grantPermissionAction(form(values))).rejects.toThrow(
      "REDIRECT:/admin?section=users&notice=updated&entity=permissions",
    );
    await expect(revokePermissionAction(form(values))).rejects.toThrow(
      "REDIRECT:/admin?section=users&notice=updated&entity=permissions",
    );
    expect(permissions.grantPermission).toHaveBeenCalledWith({ userId: "user-1", permission: "SECTOR_SERVICES" });
    expect(permissions.revokePermission).toHaveBeenCalledWith({ userId: "user-1", permission: "SECTOR_SERVICES" });
  });

  it("reports an ineligible profile and an inactive user", async () => {
    permissions.grantPermission.mockRejectedValueOnce(new ValidationError([{ path: ["permission"], code: "invalid_value" }]));
    await expect(grantPermissionAction(form({ userId: "u", permission: "QUEUE_SUPERVISION", section: "users" }))).rejects.toThrow(
      "REDIRECT:/admin?section=users&error=validation&entity=permissions",
    );

    permissions.grantPermission.mockRejectedValueOnce(new ConflictError());
    await expect(grantPermissionAction(form({ userId: "u", permission: "SECTOR_SERVICES", section: "users" }))).rejects.toThrow(
      "REDIRECT:/admin?section=users&error=dependency&entity=permissions",
    );
  });
});
