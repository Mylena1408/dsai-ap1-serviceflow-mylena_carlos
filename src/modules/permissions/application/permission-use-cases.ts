import { z } from "zod";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { PERMISSIONS, assertCanGrantPermission } from "../domain/permission";
import { assertValidityEnd, validityEndSchema } from "../domain/validity";
import type {
  PermissionEventRecord,
  PermissionGrantRecord,
  PermissionRepository,
  PermissionTransactionRunner,
} from "./ports";

// Grants by the administrator (SPEC 2026-11-01-permissoes-configuraveis, 5.2 and 5.4), with an
// optional end (SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.2).

const permissionChangeSchema = z
  .object({
    userId: entityIdSchema,
    permission: z.enum(PERMISSIONS),
  })
  .strict();

const permissionGrantSchema = permissionChangeSchema.extend({ expiresOn: validityEndSchema }).strict();

export interface PermissionOverview {
  grants: PermissionGrantRecord[];
  events: PermissionEventRecord[];
  /** The organization's calendar day, to tell "vence em" from "vencida em" (6.3.2). */
  today: string;
}

export async function listPermissionOverview(repository: PermissionRepository): Promise<PermissionOverview> {
  await requireConfigurationAdministrator();
  const [grants, events, today] = await Promise.all([repository.listGrants(), repository.listEvents(), repository.today()]);

  return { grants, events, today };
}

/**
 * Grants a permission to an active user of an eligible profile. Granting it again with the same
 * end changes nothing and records nothing (section 5.2 item 2); with another end, the grant is
 * renewed (6.3.2). Every effective change goes to the history, with the end given.
 */
export async function grantPermission(input: unknown, transactions: PermissionTransactionRunner): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const { userId, permission, expiresOn } = validateInput(permissionGrantSchema, input);

  await transactions.run(async (transaction) => {
    const holder = await transaction.findHolder(userId);

    if (!holder) {
      throw new NotFoundError();
    }

    assertCanGrantPermission(holder, permission);
    const current = await transaction.findGrant(userId, permission);

    if (current && current.expiresOn === expiresOn) {
      return;
    }

    assertValidityEnd(expiresOn, await transaction.today());
    const now = await transaction.currentTime();
    const grant = { userId, permission, grantedById: actor.id, grantedAt: now, expiresOn };

    if (current) {
      await transaction.renewGrant(grant);
    } else {
      await transaction.insertGrant(grant);
    }

    await transaction.insertEvent({ userId, permission, action: "GRANTED", actorId: actor.id, occurredAt: now, expiresOn });
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

    if (!(await transaction.findGrant(userId, permission))) {
      return;
    }

    const now = await transaction.currentTime();
    await transaction.deleteGrant(userId, permission);
    await transaction.insertEvent({ userId, permission, action: "REVOKED", actorId: actor.id, occurredAt: now, expiresOn: null });
  });
}
