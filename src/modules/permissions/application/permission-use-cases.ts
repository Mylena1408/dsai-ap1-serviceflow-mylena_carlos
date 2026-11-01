import { z } from "zod";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { PERMISSIONS, assertCanGrantPermission } from "../domain/permission";
import type {
  PermissionEventRecord,
  PermissionGrantRecord,
  PermissionRepository,
  PermissionTransactionRunner,
} from "./ports";

// Grants by the administrator (SPEC 2026-11-01-permissoes-configuraveis, 5.2 and 5.4).

const permissionChangeSchema = z
  .object({
    userId: entityIdSchema,
    permission: z.enum(PERMISSIONS),
  })
  .strict();

export interface PermissionOverview {
  grants: PermissionGrantRecord[];
  events: PermissionEventRecord[];
}

export async function listPermissionOverview(repository: PermissionRepository): Promise<PermissionOverview> {
  await requireConfigurationAdministrator();
  const [grants, events] = await Promise.all([repository.listGrants(), repository.listEvents()]);

  return { grants, events };
}

/**
 * Grants a permission to an active user of an eligible profile. Granting it again changes
 * nothing and records nothing (section 5.2 item 2); every effective change goes to the history.
 */
export async function grantPermission(input: unknown, transactions: PermissionTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { userId, permission } = validateInput(permissionChangeSchema, input);

  await transactions.run(async (transaction) => {
    const holder = await transaction.findHolder(userId);

    if (!holder) {
      throw new NotFoundError();
    }

    assertCanGrantPermission(holder, permission);

    if (await transaction.hasGrant(userId, permission)) {
      return;
    }

    const now = await transaction.currentTime();
    await transaction.insertGrant({ userId, permission, grantedById: actor.id, grantedAt: now });
    await transaction.insertEvent({ userId, permission, action: "GRANTED", actorId: actor.id, occurredAt: now });
  });
}

/** Revokes a permission; revoking one the user does not have changes nothing. */
export async function revokePermission(input: unknown, transactions: PermissionTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { userId, permission } = validateInput(permissionChangeSchema, input);

  await transactions.run(async (transaction) => {
    if (!(await transaction.findHolder(userId))) {
      throw new NotFoundError();
    }

    if (!(await transaction.hasGrant(userId, permission))) {
      return;
    }

    const now = await transaction.currentTime();
    await transaction.deleteGrant(userId, permission);
    await transaction.insertEvent({ userId, permission, action: "REVOKED", actorId: actor.id, occurredAt: now });
  });
}
