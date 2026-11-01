// Public API of the permissions module (SPEC 2026-11-01-permissoes-configuraveis).
// SF-087 exposes the rules; grants and their history come with SF-088.

export {
  PERMISSIONS,
  PERMISSION_HOLDERS,
  assertCanGrantPermission,
  canReceivePermission,
  hasPermissionInSector,
  isPermissionEffective,
} from "./domain/permission";
export type { Permission, PermissionHolder, PermissionRole } from "./domain/permission";
