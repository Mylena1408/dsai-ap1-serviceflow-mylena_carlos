import { z } from "zod";
import { ConflictError, ValidationError } from "@/server/errors";
import { PERMISSIONS, canReceivePermission, type Permission, type PermissionHolder } from "@/shared/permissions";
import { entityIdSchema } from "@/shared/validation";
import { validityEndSchema } from "./validity";

// Roles (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1, decision G13): a name and a set of
// the existing permissions, given to users. A role adds permissions only; the profile and sector
// rules of each permission stay the same.

export const MAX_ROLE_NAME_LENGTH = 60;
export const MAX_ROLE_DESCRIPTION_LENGTH = 200;
export const MAX_ROLE_PERMISSIONS = 3;

const optionalDescription = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined || value === null || value.trim() === "" ? null : value.trim()))
  .refine((value) => value === null || value.length <= MAX_ROLE_DESCRIPTION_LENGTH);

export const accessRoleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_ROLE_NAME_LENGTH),
    description: optionalDescription,
    permissions: z
      .array(z.enum(PERMISSIONS))
      .min(1)
      .max(MAX_ROLE_PERMISSIONS)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict();

export type AccessRoleInput = z.output<typeof accessRoleInputSchema>;

export const roleAssignmentSchema = z
  .object({
    userId: entityIdSchema,
    roleId: entityIdSchema,
    expiresOn: validityEndSchema,
  })
  .strict();

export const roleRemovalSchema = z.object({ userId: entityIdSchema, roleId: entityIdSchema }).strict();

export interface AccessRoleRecord {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isActive: boolean;
}

/** Permissions in the order of table 5.1, whatever order they were chosen in. */
export function orderedPermissions(permissions: readonly Permission[]): Permission[] {
  return PERMISSIONS.filter((permission) => permissions.includes(permission));
}

/** The role's permissions a profile may receive; the others are "sem efeito" for that person (6.3.1). */
export function receivablePermissions(role: Pick<AccessRoleRecord, "permissions">, holder: Pick<PermissionHolder, "role">): Permission[] {
  return orderedPermissions(role.permissions).filter((permission) => canReceivePermission(holder.role, permission));
}

/**
 * Assigning: an active role, to an active user whose profile may receive at least one of its
 * permissions (a role that would change nothing for that profile is refused, as a grant is).
 */
export function assertCanAssignRole(holder: PermissionHolder, role: AccessRoleRecord): void {
  if (receivablePermissions(role, holder).length === 0) {
    throw new ValidationError([{ path: ["roleId"], code: "invalid_value" }]);
  }
  if (!holder.isActive || !role.isActive) {
    throw new ConflictError();
  }
}
