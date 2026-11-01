export type AuthRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** Returns false for unknown hash formats or verification failures. */
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface CredentialUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  sectorId: string | null;
  isActive: boolean;
}

export interface AuthUserRepository {
  findCredentialUserByEmail(email: string): Promise<CredentialUser | null>;
  findSessionUser(userId: string): Promise<SessionUser | null>;
  findPasswordState(userId: string): Promise<{ passwordHash: string; isActive: boolean } | null>;
  /** Replaces the hash only if it still equals `expectedHash` and the user is active; returns rows changed. */
  replacePasswordHash(change: { userId: string; expectedHash: string; newHash: string }): Promise<number>;
}

export interface NewAdministrator {
  name: string;
  email: string;
  passwordHash: string;
}

/** Operations available inside the first-administrator transaction. */
export interface AdministratorBootstrapTransaction {
  countAdministrators(): Promise<number>;
  createAdministrator(
    administrator: NewAdministrator,
  ): Promise<{ id: string; name: string; email: string }>;
}

export interface AdministratorBootstrapStore {
  countAdministrators(): Promise<number>;
  /** Runs work with serializable isolation; a lost race with an existing administrator becomes a conflict. */
  run<T>(work: (transaction: AdministratorBootstrapTransaction) => Promise<T>): Promise<T>;
}

export interface DemoAccountStore {
  /** Creates or restores the demonstration account of `role` and returns its identity. */
  ensureDemoUser(role: "ADMIN" | "REQUESTER" | "ATTENDANT"): Promise<{
    id: string;
    name: string;
    email: string;
  }>;
}
