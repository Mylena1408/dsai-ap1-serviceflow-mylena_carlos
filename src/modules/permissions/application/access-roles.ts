import { activeStateAction } from "@/modules/audit";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { activeStateSchema, entityIdSchema } from "@/shared/validation";
import {
  accessRoleInputSchema,
  assertCanAssignRole,
  orderedPermissions,
  roleAssignmentSchema,
  roleRemovalSchema,
  type AccessRoleRecord,
} from "../domain/access-role";
import { assertValidityEnd } from "../domain/validity";
import type {
  AccessRoleRepository,
  AccessRoleSummary,
  AccessRoleTransactionRunner,
  RoleAssignmentRecord,
  RoleEventRecord,
} from "./ports";

// Roles configured by the administrator (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.1 and
// 6.3.3): creating, editing, deactivating and reactivating go to the audit trail; assigning and
// removing go to the user's history, with who did it, when and the end given.

export interface AccessRoleOverview {
  roles: AccessRoleSummary[];
  assignments: RoleAssignmentRecord[];
  events: RoleEventRecord[];
  today: string;
}

export async function listAccessRoleOverview(repository: AccessRoleRepository): Promise<AccessRoleOverview> {
  await requireConfigurationAdministrator();
  const [roles, assignments, events, today] = await Promise.all([
    repository.listRoles(),
    repository.listAssignments(),
    repository.listEvents(),
    repository.today(),
  ]);

  return { roles, assignments, events, today };
}

export async function createAccessRole(input: unknown, transactions: AccessRoleTransactionRunner): Promise<AccessRoleRecord> {
  const actor = await requireConfigurationAdministrator();
  const role = validateInput(accessRoleInputSchema, input);

  return transactions.run((transaction) =>
    transaction.audited({ actor, action: "CREATED", entityType: "ACCESS_ROLE" }, () =>
      transaction.createRole({ ...role, permissions: orderedPermissions(role.permissions) }),
    ),
  );
}

/** Name, description and permissions; the users holding it get the new set on their next operation. */
export async function updateAccessRole(id: unknown, input: unknown, transactions: AccessRoleTransactionRunner): Promise<AccessRoleRecord> {
  const actor = await requireConfigurationAdministrator();
  const roleId = validateInput(entityIdSchema, id);
  const role = validateInput(accessRoleInputSchema, input);

  return transactions.run(async (transaction) => {
    if (!(await transaction.findRole(roleId))) {
      throw new NotFoundError();
    }

    return transaction.audited({ actor, action: "UPDATED", entityType: "ACCESS_ROLE", entityId: roleId }, () =>
      transaction.updateRole(roleId, { ...role, permissions: orderedPermissions(role.permissions) }),
    );
  });
}

/**
 * A deactivated role stops counting for everyone at once and keeps its assignments, which count
 * again on reactivation. Reactivating a role whose name another active role took is refused by
 * the unique index of the active names.
 */
export async function setAccessRoleActive(
  id: unknown,
  isActive: unknown,
  transactions: AccessRoleTransactionRunner,
): Promise<AccessRoleRecord> {
  const actor = await requireConfigurationAdministrator();
  const roleId = validateInput(entityIdSchema, id);
  const active = validateInput(activeStateSchema, isActive);

  return transactions.run(async (transaction) => {
    const role = await transaction.findRole(roleId);

    if (!role) {
      throw new NotFoundError();
    }
    if (role.isActive === active) {
      return role;
    }

    return transaction.audited({ actor, action: activeStateAction(active), entityType: "ACCESS_ROLE", entityId: roleId }, () =>
      transaction.updateRole(roleId, { isActive: active }),
    );
  });
}

/**
 * Assigns a role, optionally up to a day (6.3.2). Assigning it again with the same end changes
 * nothing; with another end, the assignment is renewed and the history records it.
 */
export async function assignAccessRole(input: unknown, transactions: AccessRoleTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { userId, roleId, expiresOn } = validateInput(roleAssignmentSchema, input);

  await transactions.run(async (transaction) => {
    const [holder, role] = await Promise.all([transaction.findHolder(userId), transaction.findRole(roleId)]);

    if (!holder || !role) {
      throw new NotFoundError();
    }

    assertCanAssignRole(holder, role);
    const current = await transaction.findAssignment(userId, roleId);

    if (current && current.expiresOn === expiresOn) {
      return;
    }

    assertValidityEnd(expiresOn, await transaction.today());
    const now = await transaction.currentTime();
    await transaction.saveAssignment({ userId, roleId, assignedById: actor.id, assignedAt: now, expiresOn });
    await transaction.insertEvent({ userId, roleId, action: "GRANTED", actorId: actor.id, occurredAt: now, expiresOn });
  });
}

/** Removes a role from a user; removing one the user does not hold changes nothing. */
export async function removeAccessRole(input: unknown, transactions: AccessRoleTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { userId, roleId } = validateInput(roleRemovalSchema, input);

  await transactions.run(async (transaction) => {
    if (!(await transaction.findHolder(userId)) || !(await transaction.findRole(roleId))) {
      throw new NotFoundError();
    }

    if (!(await transaction.findAssignment(userId, roleId))) {
      return;
    }

    const now = await transaction.currentTime();
    await transaction.deleteAssignment(userId, roleId);
    await transaction.insertEvent({ userId, roleId, action: "REVOKED", actorId: actor.id, occurredAt: now, expiresOn: null });
  });
}
