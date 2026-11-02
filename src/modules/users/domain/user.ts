export type UserRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

/** User data exposed to administration; never includes the password hash. */
export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  sectorId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** When the person was anonymized (SPEC 2026-11-02-auditoria-lgpd, 5.5); null otherwise. */
  anonymizedAt: Date | null;
}

export interface UserState {
  id: string;
  role: UserRole;
  sectorId: string | null;
  isActive: boolean;
  anonymizedAt: Date | null;
}
