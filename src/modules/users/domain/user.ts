export type UserRole = "ADMIN" | "REQUESTER" | "ATTENDANT";

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
}

export interface UserState {
  id: string;
  role: UserRole;
  sectorId: string | null;
  isActive: boolean;
}
