import type { AuditScope } from "@/modules/audit";
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
export interface UserTransaction extends AuditScope {
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

// Anonymization (SPEC 2026-11-02-auditoria-lgpd, 5.5): every effect in one transaction.

export interface AnonymizationTarget {
  id: string;
  role: UserRole;
  isActive: boolean;
  anonymizedAt: Date | null;
}

export interface AnonymizationTransaction extends AuditScope {
  currentTime(): Promise<Date>;
  findTarget(userId: string): Promise<AnonymizationTarget | null>;
  countActiveAdministrators(): Promise<number>;
  /** Requests open or in attendance with the person as requester or assignee. */
  countOngoingRequests(userId: string): Promise<number>;
  /** New name and e-mail, a hash that never authenticates and the anonymization time. */
  replaceIdentity(
    userId: string,
    identity: { name: string; email: string; passwordHash: string; anonymizedAt: Date },
  ): Promise<void>;
  /**
   * Replaces the texts written by the person: descriptions of the requests opened, answers to
   * text fields of those requests, comments, approval notes and notes in the history.
   */
  replaceWrittenContent(userId: string, replacement: string, textFieldTypes: readonly string[]): Promise<void>;
  /** Deletes e-mail preferences, notifications and e-mail delivery records of the person. */
  deleteNotificationData(userId: string): Promise<void>;
  /** Revokes every permission of the person, writing each revocation in the permission history. */
  revokePermissions(userId: string, actorId: string, occurredAt: Date): Promise<void>;
  /** Revokes every API token of the person (SPEC 2026-11-02-api-externa-webhooks, 5.7). */
  revokeApiTokens(userId: string, actorId: string, revokedAt: Date): Promise<void>;
  /** Marks the attachments sent by the person as removed and returns their storage keys. */
  markAttachmentsRemoved(userId: string, filename: string, removedAt: Date): Promise<string[]>;
  /** Earlier audit entries about the person show the new name, never the old one (SPEC, 9). */
  relabelAuditEntries(userId: string, label: string): Promise<void>;
}

export interface AnonymizationTransactionRunner {
  run<T>(work: (transaction: AnonymizationTransaction) => Promise<T>): Promise<T>;
}

/** Removes attachment files from the private storage; removing a missing file succeeds. */
export interface AttachmentFileRemover {
  remove(storageKey: string): Promise<void>;
}

export interface AnonymizationDependencies {
  transactions: AnonymizationTransactionRunner;
  files: AttachmentFileRemover;
}
