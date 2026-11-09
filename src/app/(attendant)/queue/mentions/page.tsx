import { listMyMentions } from "@/modules/comments";
import { MyMentionsList } from "@/app/_components/my-mentions";
import { requireAttendantPageAccess } from "../../page-access";
import { openMentionAction } from "./actions";

// "Minhas menções" (SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1; correction of 13.10: only attendants).

type MentionsPageProps = { searchParams: Promise<{ error?: string }> };

export default async function MentionsPage({ searchParams }: MentionsPageProps) {
  await requireAttendantPageAccess();
  const [{ error }, mentions] = await Promise.all([searchParams, listMyMentions()]);
  return <MyMentionsList error={error} mentions={mentions} openAction={openMentionAction} />;
}
