"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markAllNotificationsRead } from "@/modules/notifications";
import { requireCurrentActor } from "@/server/authorization";
import { ApplicationError } from "@/server/errors";

export async function notificationsPathFor(role: string): Promise<string> {
  return role === "ATTENDANT" ? "/queue/notifications" : "/notifications";
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
