import type { Permission, PermissionHolder } from "../domain/permission";

export interface PermissionGrantRecord {
  userId: string;
  permission: Permission;
  grantedAt: Date;
}

export interface PermissionEventRecord {
  id: string;
  userId: string;
  permission: Permission;
  action: "GRANTED" | "REVOKED";
  occurredAt: Date;
  actor: { id: string; name: string };
}

export interface PermissionRepository {
  /** Every grant, of every user. */
  listGrants(): Promise<PermissionGrantRecord[]>;
  /** History of every user, most recent first. */
  listEvents(): Promise<PermissionEventRecord[]>;
}

/** Operations available inside a grant transaction. */
export interface PermissionTransaction {
  currentTime(): Promise<Date>;
  findHolder(userId: string): Promise<PermissionHolder | null>;
  hasGrant(userId: string, permission: Permission): Promise<boolean>;
  insertGrant(grant: { userId: string; permission: Permission; grantedById: string; grantedAt: Date }): Promise<void>;
  deleteGrant(userId: string, permission: Permission): Promise<void>;
  insertEvent(event: {
    userId: string;
    permission: Permission;
    action: "GRANTED" | "REVOKED";
    actorId: string;
    occurredAt: Date;
  }): Promise<void>;
}

/** Runs work atomically with serializable isolation. */
export interface PermissionTransactionRunner {
  run<T>(work: (transaction: PermissionTransaction) => Promise<T>): Promise<T>;
}
