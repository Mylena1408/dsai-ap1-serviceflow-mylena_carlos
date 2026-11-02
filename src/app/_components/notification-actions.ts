"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markAllNotificationsRead, updateEmailPreferences } from "@/modules/notifications";
import { requireCurrentActor } from "@/server/authorization";
import { ApplicationError, AuthenticationError, AuthorizationError, ValidationError } from "@/server/errors";

export async function notificationsPathFor(role: string): Promise<string> {
  if (role === "MANAGER") return "/approvals/notifications";
  return role === "ATTENDANT" ? "/queue/notifications" : "/notifications";
}

/** "Preferências de notificação" of each area (SPEC 2026-11-01-notificacoes-email-preferencias, 5.1). */
export async function preferencesPathFor(role: string): Promise<string> {
  return `${await notificationsPathFor(role)}/preferences`;
}

/** Saves the signed-in person's email choice: the checked categories on, the others off. */
export async function saveEmailPreferencesAction(formData: FormData): Promise<never> {
  let path = "/notifications/preferences";
  let notice = "saved";

  try {
    const actor = await requireCurrentActor();
    path = await preferencesPathFor(actor.role);
    await updateEmailPreferences({ categories: formData.getAll("category").map(String) });
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login");
    if (error instanceof AuthorizationError) redirect("/");
    if (!(error instanceof ValidationError)) throw error;
    // Only a tampered form lists something outside the six categories.
    notice = "invalid";
  }

  redirect(`${path}?notice=${notice}`);
}

/** Marks only the signed-in user's notifications as read (section 8.2). */
export async function markAllNotificationsAction(): Promise<never> {
  let path = "/notifications";

  try {
    const actor = await requireCurrentActor();
    path = await notificationsPathFor(actor.role);
    await markAllNotificationsRead();
  } catch (error) {
    if (error instanceof ApplicationError) redirect("/login");
    throw error;
  }

  // The unread counter is rendered by the layouts.
  revalidatePath("/", "layout");
  redirect(path);
}
