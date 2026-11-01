// Additional permissions (SPEC 2026-11-01-permissoes-configuraveis, sections 5.1 to 5.3). Pure
// rules shared by the permissions module and the server authorization. They only add actions
// inside the holder's current sector; no permission removes a profile rule.

export const PERMISSIONS = ["SECTOR_SERVICES", "SECTOR_REQUESTS_READ", "QUEUE_SUPERVISION"] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type PermissionRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

// Table 5.1: who may receive each permission.
export const PERMISSION_HOLDERS: Record<Permission, readonly PermissionRole[]> = {
  SECTOR_SERVICES: ["ATTENDANT", "MANAGER"],
  SECTOR_REQUESTS_READ: ["MANAGER"],
  QUEUE_SUPERVISION: ["ATTENDANT"],
};

export interface PermissionHolder {
  role: PermissionRole;
  isActive: boolean;
  sectorId: string | null;
}

export function canReceivePermission(role: PermissionRole, permission: Permission): boolean {
  return PERMISSION_HOLDERS[permission].includes(role);
}

/**
 * Section 5.2 item 3: a granted permission counts only while the holder is active, keeps a
 * profile that may receive it and has a sector. Without `sectorId`, any sector of the holder.
 */
export function isPermissionEffective(holder: PermissionHolder, permission: Permission): boolean {
  return holder.isActive && holder.sectorId !== null && canReceivePermission(holder.role, permission);
}

/** Whether the holder may use `permission` in `sectorId` (always the holder's own sector, 5.2.3). */
export function hasPermissionInSector(
  holder: PermissionHolder,
  granted: readonly Permission[],
  permission: Permission,
  sectorId: string,
): boolean {
  return granted.includes(permission) && isPermissionEffective(holder, permission) && holder.sectorId === sectorId;
}
