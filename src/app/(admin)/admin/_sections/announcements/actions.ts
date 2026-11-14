"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AnnouncementConflict, closeAnnouncement, createAnnouncement, deleteAnnouncement, updateAnnouncement } from "@/modules/announcements";
import { ApplicationError, ValidationError } from "@/server/errors";
import { announcementErrorCode } from "./messages";

// The announcements of the administration (SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 1 and 3.3). The page
// to go back to is always the section, never an address from the form.

const PAGE = "/admin?section=announcements";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function run(work: () => Promise<unknown>, notice: string): Promise<never> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ApplicationError) {
      const reason = error instanceof AnnouncementConflict ? error.reason : null;
      const path = error instanceof ValidationError ? String(error.issues[0]?.path[0] ?? "") : null;
      redirect(`${PAGE}&announcementResult=${announcementErrorCode(error.code, reason, path)}`);
    }
    throw error;
  }
  revalidatePath("/admin");
  redirect(`${PAGE}&announcementResult=${notice}`);
}

/** The fields of the form; the ones of another kind or audience are ignored by the rules. */
const input = (formData: FormData) => ({
  title: field(formData, "title"),
  body: field(formData, "body"),
  kind: field(formData, "kind"),
  level: field(formData, "level"),
  audience: field(formData, "audience"),
  audienceRole: field(formData, "audienceRole"),
  audienceSectorId: field(formData, "audienceSectorId"),
  startsAt: field(formData, "startsAt"),
  endsAt: field(formData, "endsAt"),
  leadHours: field(formData, "leadHours"),
});

export async function createAnnouncementAction(formData: FormData): Promise<never> {
  return run(() => createAnnouncement(input(formData)), "created");
}

export async function updateAnnouncementAction(formData: FormData): Promise<never> {
  return run(() => updateAnnouncement(field(formData, "announcementId"), input(formData)), "updated");
}

export async function closeAnnouncementAction(formData: FormData): Promise<never> {
  return run(() => closeAnnouncement(field(formData, "announcementId")), "closed");
}

export async function deleteAnnouncementAction(formData: FormData): Promise<never> {
  return run(() => deleteAnnouncement(field(formData, "announcementId")), "deleted");
}
