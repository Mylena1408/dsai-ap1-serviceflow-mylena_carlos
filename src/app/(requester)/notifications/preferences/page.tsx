import { getEmailPreferences } from "@/modules/notifications";
import { EmailPreferencesPage } from "@/app/_components/email-preferences";
import { requireRequesterPageAccess } from "../../page-access";

type PreferencesPageProps = { searchParams: Promise<{ notice?: string }> };

export default async function RequesterNotificationPreferencesPage({ searchParams }: PreferencesPageProps) {
  await requireRequesterPageAccess();
  const [preferences, { notice }] = await Promise.all([getEmailPreferences(), searchParams]);

  return <EmailPreferencesPage notice={notice} notificationsHref="/notifications" preferences={preferences} />;
}
