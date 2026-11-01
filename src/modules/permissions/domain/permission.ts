import { ConflictError, ValidationError } from "@/server/errors";
import { canReceivePermission, type Permission, type PermissionHolder } from "@/shared/permissions";

// Grant rules of the permissions module; the rules of when a permission counts are shared with
// the server authorization in @/shared/permissions.

export {
  PERMISSIONS,
  PERMISSION_HOLDERS,
  canReceivePermission,
  hasPermissionInSector,
  isPermissionEffective,
} from "@/shared/permissions";
export type { Permission, PermissionHolder, PermissionRole } from "@/shared/permissions";

/** Section 5.2 item 2: only active users of a profile that may receive it. */
export function assertCanGrantPermission(holder: PermissionHolder, permission: Permission): void {
  if (!canReceivePermission(holder.role, permission)) {
    throw new ValidationError([{ path: ["permission"], code: "invalid_value" }]);
  }

  if (!holder.isActive) {
    throw new ConflictError();
  }
}

