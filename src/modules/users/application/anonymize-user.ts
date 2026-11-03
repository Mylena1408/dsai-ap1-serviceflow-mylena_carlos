import { z } from "zod";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  ANONYMIZED_CONTENT,
  REMOVED_ATTACHMENT_NAME,
  TEXT_FIELD_TYPES,
  UNUSABLE_PASSWORD_HASH,
  anonymizedIdentity,
  assertCanAnonymize,
} from "../domain/anonymization";
import type { AnonymizationDependencies } from "./ports";

// Anonymization by the administrator (SPEC 2026-11-02-auditoria-lgpd, 5.5, decision D4).

/** The explicit confirmation of 5.5.2 is part of the input: without it nothing happens. */
const anonymizationInputSchema = z
  .object({
    userId: entityIdSchema,
    confirmed: z.literal(true),
  })
  .strict();

export interface AnonymizedUser {
  id: string;
  name: string;
}

/**
 * Anonymizes a deactivated person. Every database effect of 5.5.3 happens in one transaction,
 * recorded in the audit without the old name or e-mail (CA-AUD-09). The attachment files are
 * removed last, still inside the transaction: if the storage fails, the database changes are
 * rolled back and the administrator can try again (removing a file twice is harmless), so a
 * person is never marked as anonymized while her files remain stored.
 */
export async function anonymizeUser(
  input: unknown,
  { transactions, files }: AnonymizationDependencies,
): Promise<AnonymizedUser> {
  const actor = await requireConfigurationAdministrator();
  const { userId } = validateInput(anonymizationInputSchema, input);

  return transactions.run(async (transaction) => {
    const target = await transaction.findTarget(userId);

    if (!target) {
      throw new NotFoundError();
    }

    assertCanAnonymize({
      actorId: actor.id,
      target,
      activeAdministratorCount: await transaction.countActiveAdministrators(),
      ongoingRequestCount: await transaction.countOngoingRequests(userId),
    });

    const identity = anonymizedIdentity(userId);
    const now = await transaction.currentTime();

    return transaction.audited({ actor, action: "ANONYMIZED", entityType: "USER", entityId: userId }, async () => {
      await transaction.replaceIdentity(userId, {
        ...identity,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        anonymizedAt: now,
      });
      await transaction.replaceWrittenContent(userId, ANONYMIZED_CONTENT, TEXT_FIELD_TYPES);
      await transaction.deleteNotificationData(userId);
      await transaction.revokePermissions(userId, actor.id, now);
      await transaction.revokeApiTokens(userId, actor.id, now);
      await transaction.relabelAuditEntries(userId, identity.name);
      const storageKeys = await transaction.markAttachmentsRemoved(userId, REMOVED_ATTACHMENT_NAME, now);

      for (const storageKey of storageKeys) {
        await files.remove(storageKey);
      }

      return { id: userId, name: identity.name };
    });
  });
}
