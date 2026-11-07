"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelGroup } from "@/modules/requests";
import { ApplicationError } from "@/server/errors";
import { scheduleEventProcessing } from "@/server/jobs/schedule";

// Cancelling a bundle (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4): the page then says how many
// requests were cancelled and how many stay as they are.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function cancelGroupAction(formData: FormData): Promise<never> {
  const groupId = field(formData, "groupId");
  let result;

  try {
    result = await cancelGroup({ groupId, note: field(formData, "note") });
  } catch (error) {
    if (error instanceof ApplicationError) redirect(`/requests/groups/${encodeURIComponent(groupId)}?error=${error.code === "NOT_FOUND" ? "missing" : "unexpected"}`);
    throw error;
  }

  scheduleEventProcessing();
  revalidatePath("/requests");
  revalidatePath(`/requests/groups/${groupId}`);
  redirect(`/requests/groups/${groupId}?cancelled=${result.cancelled.length}&kept=${result.kept.length}`);
}
