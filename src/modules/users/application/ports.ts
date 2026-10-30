import type { ManagedUser, UserRole, UserState } from "../domain/user";

export interface UserRepository {
  /** Users ordered by name and e-mail, without password hashes. */
  listByName(): Promise<ManagedUser[]>;
}

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  sectorId: string | null;
}

export interface UserChanges {
  name?: string;
  email?: string;
  role?: UserRole;
  sectorId?: string | null;
  passwordHash?: string;
  isActive?: boolean;
}

/** Operations available inside a user transaction. */
export interface UserTransaction {
  findState(userId: string): Promise<UserState | null>;
  findSectorActivity(sectorId: string): Promise<{ isActive: boolean } | null>;
  countActiveAdministrators(): Promise<number>;
  countPendingRequestsInSector(sectorId: string): Promise<number>;
  countOtherActiveAttendants(sectorId: string, excludedUserId: string): Promise<number>;
  create(user: NewUser): Promise<ManagedUser>;
  update(userId: string, changes: UserChanges): Promise<ManagedUser>;
}

/** Runs work atomically with serializable isolation. */
export interface UserTransactionRunner {
  run<T>(work: (transaction: UserTransaction) => Promise<T>): Promise<T>;
}

export interface UserCommandDependencies {
  transactions: UserTransactionRunner;
  hashPassword(password: string): Promise<string>;
}
