"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setFollowPreference } from "@/modules/followers";

// "Seguir automaticamente as solicitações em que comento" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2;
// decision J7). A checkbox is absent when unchecked, so the form's own marker says the choice was sent.

export async function saveFollowPreferenceAction(formData: FormData): Promise<never> {
  await setFollowPreference({ autoFollowOnComment: formData.get("autoFollowOnComment") === "on" });
  revalidatePath("/queue/notifications/preferences");
  redirect("/queue/notifications/preferences?notice=follow-saved");
}
