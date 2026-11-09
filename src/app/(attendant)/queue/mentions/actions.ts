"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { openMention } from "@/modules/comments";
import { ApplicationError } from "@/server/errors";

// Opening a mention (SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1): marks it seen and goes to the conversation.

export async function openMentionAction(formData: FormData): Promise<never> {
  const value = formData.get("commentId");
  let requestId: string;
  try {
    requestId = await openMention(typeof value === "string" ? value : "");
  } catch (error) {
    if (error instanceof ApplicationError) redirect("/queue/mentions?error=missing");
    throw error;
  }
  revalidatePath("/queue/mentions");
  redirect(`/queue/${encodeURIComponent(requestId)}#conversa`);
}
