import { getEmailPreferences } from "@/modules/notifications";
import { EmailPreferencesPage } from "@/app/_components/email-preferences";
import { requireManagerPageAccess } from "../../../page-access";

type PreferencesPageProps = { searchParams: Promise<{ notice?: string }> };

export default async function ManagerNotificationPreferencesPage({ searchParams }: PreferencesPageProps) {
  await requireManagerPageAccess();
  const [preferences, { notice }] = await Promise.all([getEmailPreferences(), searchParams]);

  return <EmailPreferencesPage notice={notice} notificationsHref="/approvals/notifications" preferences={preferences} />;
}
