import { notificationMessage, type MessageSource } from "@/shared/notifications";

// Content of a notification email (SPEC 2026-11-01-notificacoes-email-preferencias, 5.4): the
// notification text, the service, the short code and the links. Nothing else about the request
// (description, comments, notes, answers, documents or approval remarks) is ever passed in.

export type EmailRecipientRole = "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface EmailContentSource extends MessageSource {
  requestId: string;
  recipientRole: EmailRecipientRole;
}

export interface EmailContent {
  subject: string;
  text: string;
}

const AREAS: Record<EmailRecipientRole, { request: string; notifications: string }> = {
  REQUESTER: { request: "/requests", notifications: "/notifications" },
  ATTENDANT: { request: "/queue", notifications: "/queue/notifications" },
  MANAGER: { request: "/approvals", notifications: "/approvals/notifications" },
};

/** The first block of the identifier, as people quote a request in a conversation. */
export function requestShortCode(requestId: string): string {
  return requestId.slice(0, 8).toUpperCase();
}

/** `baseUrl` is the configured origin (APP_BASE_URL), without a trailing slash. */
export function buildNotificationEmail(source: EmailContentSource, baseUrl: string): EmailContent {
  const message = notificationMessage(source);
  const area = AREAS[source.recipientRole];
  const origin = baseUrl.replace(/\/+$/, "");

  return {
    // The notification text already names the service (SPEC 5.4, clarified in SF-094).
    subject: `[ServiceFlow] ${message}`,
    text: [
      message,
      "",
      `Serviço: ${source.serviceName}`,
      `Solicitação: ${requestShortCode(source.requestId)}`,
      `Abrir: ${origin}${area.request}/${source.requestId}`,
      "",
      "Os detalhes ficam no ServiceFlow, com as regras de acesso de sempre.",
      `Para escolher o que você recebe por e-mail: ${origin}${area.notifications}/preferences`,
    ].join("\n"),
  };
}
