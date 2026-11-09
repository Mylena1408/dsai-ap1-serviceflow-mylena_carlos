import { getEmailPreferences } from "@/modules/notifications";
import { getFollowPreference } from "@/modules/followers";
import { EmailPreferencesPage } from "@/app/_components/email-preferences";
import { FollowPreferenceForm } from "@/app/_components/follow-preference";
import { requireAttendantPageAccess } from "../../../page-access";
import { saveFollowPreferenceAction } from "./follow-actions";

type PreferencesPageProps = { searchParams: Promise<{ notice?: string }> };

export default async function AttendantNotificationPreferencesPage({ searchParams }: PreferencesPageProps) {
  await requireAttendantPageAccess();
  const [preferences, follow, { notice }] = await Promise.all([getEmailPreferences(), getFollowPreference(), searchParams]);

  return (
    <>
      <EmailPreferencesPage notice={notice} notificationsHref="/queue/notifications" preferences={preferences} />
      {/* SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2 (decision J7). */}
      <div className="page-shell">
        <FollowPreferenceForm action={saveFollowPreferenceAction} autoFollowOnComment={follow.autoFollowOnComment} saved={notice === "follow-saved"} />
      </div>
    </>
  );
}
