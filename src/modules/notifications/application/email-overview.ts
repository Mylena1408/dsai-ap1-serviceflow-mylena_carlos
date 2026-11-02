import { requireConfigurationAdministrator } from "@/server/authorization";
import type { EmailDeliveryLog, EmailDeliveryRecord } from "./ports";

// Follow-up of the emails by the administrator (SPEC 2026-11-01-notificacoes-email-preferencias,
// 5.5, decision N5): whether sending is configured, never the values, and the latest deliveries,
// never their content.

export const RECENT_EMAIL_DELIVERIES = 50;

export interface EmailOverview {
  configured: boolean;
  deliveries: EmailDeliveryRecord[];
}

export async function getEmailOverview(log: EmailDeliveryLog, configured: boolean): Promise<EmailOverview> {
  await requireConfigurationAdministrator();
  return { configured, deliveries: await log.listRecent(RECENT_EMAIL_DELIVERIES) };
}
