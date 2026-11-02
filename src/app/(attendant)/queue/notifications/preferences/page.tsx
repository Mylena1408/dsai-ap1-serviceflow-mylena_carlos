import { getEmailPreferences } from "@/modules/notifications";
import { EmailPreferencesPage } from "@/app/_components/email-preferences";
import { requireAttendantPageAccess } from "../../../page-access";

type PreferencesPageProps = { searchParams: Promise<{ notice?: string }> };

export default async function AttendantNotificationPreferencesPage({ searchParams }: PreferencesPageProps) {
  await requireAttendantPageAccess();
  const [preferences, { notice }] = await Promise.all([getEmailPreferences(), searchParams]);

  return <EmailPreferencesPage notice={notice} notificationsHref="/queue/notifications" preferences={preferences} />;
}
