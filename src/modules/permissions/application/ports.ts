import type { AuditScope } from "@/modules/audit";
import type { AccessRoleInput, AccessRoleRecord } from "../domain/access-role";
import type { Permission, PermissionHolder } from "../domain/permission";

export interface PermissionGrantRecord {
  userId: string;
  permission: Permission;
  grantedAt: Date;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2: last day it counts, or null. */
  expiresOn: string | null;
}

export interface PermissionEventRecord {
  id: string;
  userId: string;
  permission: Permission;
  action: "GRANTED" | "REVOKED";
  occurredAt: Date;
  actor: { id: string; name: string };
  expiresOn: string | null;
}

export interface PermissionRepository {
  /** Every grant, of every user. */
  listGrants(): Promise<PermissionGrantRecord[]>;
  /** History of every user, most recent first. */
  listEvents(): Promise<PermissionEventRecord[]>;
  /** The organization's calendar day now (6.3.2). */
  today(): Promise<string>;
}

/** Operations available inside a grant transaction. */
export interface PermissionTransaction {
  currentTime(): Promise<Date>;
  today(): Promise<string>;
  findHolder(userId: string): Promise<PermissionHolder | null>;
  /** The grant, with its end, or null without one. */
  findGrant(userId: string, permission: Permission): Promise<{ expiresOn: string | null } | null>;
  insertGrant(grant: {
    userId: string;
    permission: Permission;
    grantedById: string;
    grantedAt: Date;
    expiresOn: string | null;
  }): Promise<void>;
  /** Granting again with another end: the grant keeps its row and takes the new end (6.3.2). */
  renewGrant(grant: { userId: string; permission: Permission; grantedById: string; grantedAt: Date; expiresOn: string | null }): Promise<void>;
  deleteGrant(userId: string, permission: Permission): Promise<void>;
  insertEvent(event: {
    userId: string;
    permission: Permission;
    action: "GRANTED" | "REVOKED";
    actorId: string;
    occurredAt: Date;
    expiresOn: string | null;
  }): Promise<void>;
}

/** Runs work atomically with serializable isolation. */
export interface PermissionTransactionRunner {
  run<T>(work: (transaction: PermissionTransaction) => Promise<T>): Promise<T>;
}

// Roles (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1 and 6.3.3).

export interface AccessRoleSummary extends AccessRoleRecord {
  /** Users holding it, whether or not the assignment has ended. */
  assignmentCount: number;
}

export interface RoleAssignmentRecord {
  userId: string;
  roleId: string;
  assignedAt: Date;
  expiresOn: string | null;
}

export interface RoleEventRecord {
  id: string;
  userId: string;
  role: { id: string; name: string };
  action: "GRANTED" | "REVOKED";
  occurredAt: Date;
  actor: { id: string; name: string };
  expiresOn: string | null;
}

export interface AccessRoleRepository {
  /** Active first, then by name. */
  listRoles(): Promise<AccessRoleSummary[]>;
  listAssignments(): Promise<RoleAssignmentRecord[]>;
  /** History of every user, most recent first. */
  listEvents(): Promise<RoleEventRecord[]>;
  today(): Promise<string>;
}

export interface AccessRoleTransaction extends AuditScope {
  currentTime(): Promise<Date>;
  today(): Promise<string>;
  findRole(roleId: string): Promise<AccessRoleRecord | null>;
  createRole(input: AccessRoleInput): Promise<AccessRoleRecord>;
  updateRole(roleId: string, data: Partial<AccessRoleInput> & { isActive?: boolean }): Promise<AccessRoleRecord>;
  findHolder(userId: string): Promise<PermissionHolder | null>;
  findAssignment(userId: string, roleId: string): Promise<{ expiresOn: string | null } | null>;
  /** Creates the assignment or gives the existing one the new end and assigner. */
  saveAssignment(assignment: { userId: string; roleId: string; assignedById: string; assignedAt: Date; expiresOn: string | null }): Promise<void>;
  deleteAssignment(userId: string, roleId: string): Promise<void>;
  insertEvent(event: {
    userId: string;
    roleId: string;
    action: "GRANTED" | "REVOKED";
    actorId: string;
    occurredAt: Date;
    expiresOn: string | null;
  }): Promise<void>;
}

export interface AccessRoleTransactionRunner {
  run<T>(work: (transaction: AccessRoleTransaction) => Promise<T>): Promise<T>;
}
