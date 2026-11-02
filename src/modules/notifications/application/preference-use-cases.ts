import { z } from "zod";
import { requireCurrentActor, type AuthorizationActor } from "@/server/authorization";
import { AuthorizationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "../domain/email";
import type { NotificationPreferenceStore } from "./ports";

// Email preferences (SPEC 2026-11-01-notificacoes-email-preferencias, 5.1 and 5.6). The person is
// always the signed-in user: no input names a user, so nobody changes someone else's choice.

export type EmailPreferences = Record<NotificationCategory, boolean>;

const RECEIVERS = new Set(["REQUESTER", "ATTENDANT", "MANAGER"]);

const preferencesSchema = z
  .object({
    categories: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length),
  })
  .strict();

/** Administrators receive no notifications, so they have no preferences either. */
async function requirePreferenceOwner(): Promise<AuthorizationActor> {
  const actor = await requireCurrentActor();
  if (!RECEIVERS.has(actor.role)) {
    throw new AuthorizationError();
  }
  return actor;
}

export async function getEmailPreferences(store: NotificationPreferenceStore): Promise<EmailPreferences> {
  const actor = await requirePreferenceOwner();
  const enabled = await store.enabledCategories(actor.id);
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, enabled.has(category)])) as EmailPreferences;
}

/** `categories` lists the categories with email on; every other one is turned off. */
export async function updateEmailPreferences(input: unknown, store: NotificationPreferenceStore): Promise<void> {
  const actor = await requirePreferenceOwner();
  const { categories } = validateInput(preferencesSchema, input);
  const enabled = new Set(categories);
  const choices = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, enabled.has(category)])) as EmailPreferences;
  await store.save(actor.id, choices, new Date());
}
