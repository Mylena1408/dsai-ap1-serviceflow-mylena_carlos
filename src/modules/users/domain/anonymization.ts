import { ConflictError } from "@/server/errors";
import type { UserRole } from "./user";

// Anonymization of a person who left the organization (SPEC 2026-11-02-auditoria-lgpd, 5.5,
// decision D4). Identity and the content the person wrote go away; requests, history, dates,
// statuses and dashboard numbers stay.

/** Replaces every text the person wrote (5.5.3). */
export const ANONYMIZED_CONTENT = "[conteúdo removido na anonimização]";

/** Name kept for an attachment whose file was removed (5.5.3). */
export const REMOVED_ATTACHMENT_NAME = "Arquivo removido na anonimização";

/**
 * Stored in place of the password hash. It is not an argon2id hash, so the password check
 * refuses it before any comparison: the account never authenticates again (CA-AUD-08).
 */
export const UNUSABLE_PASSWORD_HASH = "!anonimizado";

/** Field types whose answers are free text written by the person (5.5.3). */
export const TEXT_FIELD_TYPES = ["SHORT_TEXT", "LONG_TEXT"] as const;

/**
 * Code shown in the new name and e-mail: the last 12 hexadecimal digits of the id, which are
 * random in a UUID v4. It is stable for the person and keeps the e-mail unique without
 * carrying anything of the old identity.
 */
export function anonymizationCode(userId: string): string {
  return userId.replace(/-/g, "").slice(-12).toLowerCase();
}

export interface AnonymizedIdentity {
  name: string;
  email: string;
}

export function anonymizedIdentity(userId: string): AnonymizedIdentity {
  const code = anonymizationCode(userId);

  return {
    name: `Pessoa anonimizada ${code}`,
    email: `anonimizado-${code}@anonimizado.invalid`,
  };
}

export interface AnonymizationCheck {
  actorId: string;
  target: { id: string; role: UserRole; isActive: boolean; anonymizedAt: Date | null };
  activeAdministratorCount: number;
  /** Requests open or in attendance with the person as requester or assignee. */
  ongoingRequestCount: number;
}

/**
 * Conditions of 5.5.1: only deactivated people, never oneself nor the last active
 * administrator, and only without requests open or in attendance. Anonymizing twice is
 * refused too: the action is irreversible and happens once (5.5.2).
 */
export function assertCanAnonymize({
  actorId,
  target,
  activeAdministratorCount,
  ongoingRequestCount,
}: AnonymizationCheck): void {
  const lastActiveAdministrator = target.role === "ADMIN" && target.isActive && activeAdministratorCount <= 1;

  if (
    target.id === actorId ||
    target.isActive ||
    target.anonymizedAt !== null ||
    lastActiveAdministrator ||
    ongoingRequestCount > 0
  ) {
    throw new ConflictError();
  }
}

/** Anonymized people cannot be edited, reactivated or given access again (5.5.2). */
export function assertNotAnonymized(user: { anonymizedAt: Date | null }): void {
  if (user.anonymizedAt !== null) {
    throw new ConflictError();
  }
}
