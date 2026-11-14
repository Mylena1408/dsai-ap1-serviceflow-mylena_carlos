"use server";

import { revalidatePath } from "next/cache";
import { dismissAnnouncement } from "@/modules/announcements";
import { ApplicationError } from "@/server/errors";

// "Dispensar" in the strip (SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 4; SF-237): the same screen comes
// back without the announcement. A refused dismissal (the announcement ended, was closed or became a warning)
// only refreshes the screen, without a message.

export async function dismissAnnouncementAction(formData: FormData): Promise<void> {
  const announcementId = formData.get("announcementId");
  try {
    await dismissAnnouncement(typeof announcementId === "string" ? announcementId : "");
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
  }
  // The strip is in the root layout: every screen that shows it is refreshed.
  revalidatePath("/", "layout");
}
