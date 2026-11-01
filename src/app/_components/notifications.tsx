import Link from "next/link";
import {
  countUnreadNotifications,
  type NotificationRecord,
  type NotificationType,
} from "@/modules/notifications";

// In-app notifications (SPEC 2026-10-31-eventos-outbox-jobs, section 8.2). Messages are built
// from the type and the service name; no comment, note or reason text is ever copied.

const MESSAGES: Record<NotificationType, (service: string, stage?: string) => string> = {
  "status.IN_PROGRESS": (service) => `Atendimento iniciado: ${service}`,
  "status.COMPLETED": (service) => `Solicitação concluída: ${service}`,
  "status.CANCELLED": (service) => `Solicitação cancelada: ${service}`,
  "status.OPEN": (service) => `Solicitação reaberta: ${service}`,
  "assignment.received": (service) => `Uma solicitação foi transferida para você: ${service}`,
  "comment.public": (service) => `Novo comentário em ${service}`,
  "comment.internal": (service) => `Nova nota interna em ${service}`,
  "sla.warning": (service) => `Prazo próximo do vencimento: ${service}`,
  "sla.breached": (service) => `Prazo vencido: ${service}`,
  // The stage name is missing once the event is purged (after 30 days).
  "stage.changed": (service, stage) =>
    stage ? `Sua solicitação passou para a etapa ${stage}: ${service}` : `Sua solicitação mudou de etapa: ${service}`,
};

export function notificationMessage(notification: NotificationRecord): string {
  return (MESSAGES[notification.type] ?? ((service: string) => `Novidade em ${service}`))(
    notification.serviceName,
    notification.stageName,
  );
}

/** Top bar link with the unread count; never breaks the page if counting fails. */
export async function NotificationsLink({ href }: { href: string }) {
  let unread = 0;

  try {
    unread = await countUnreadNotifications();
  } catch {
    // The page itself enforces access; the link just shows no count.
  }

  return (
    <Link href={href} aria-label={unread > 0 ? `Notificações, ${unread} não lidas` : "Notificações"}>
      Notificações{unread > 0 ? <span className="notification-badge"> {unread}</span> : null}
    </Link>
  );
}

type NotificationListProps = {
  notifications: NotificationRecord[];
  markAllAction: () => Promise<never>;
};

export function NotificationList({ notifications, markAllAction }: NotificationListProps) {
  const unread = notifications.filter(({ readAt }) => readAt === null).length;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Avisos</p>
          <h1>Notificações</h1>
          <p>{unread === 1 ? "1 não lida" : `${unread} não lidas`} entre as 50 mais recentes.</p>
        </div>
        {unread > 0 ? (
          <form action={markAllAction}>
            <button className="button-secondary" type="submit">Marcar todas como lidas</button>
          </form>
        ) : null}
      </header>
      {notifications.length === 0 ? (
        <p className="empty-state">Nenhuma notificação por enquanto.</p>
      ) : (
        <ul className="content-list notification-list">
          {notifications.map((notification) => (
            <li key={notification.id} className={notification.readAt ? undefined : "is-unread"}>
              {/* A full navigation: the counter lives in the layout, which a client-side
                  navigation would keep stale after the notification is marked as read. */}
              <a href={`/api/notifications/${notification.id}`}>{notificationMessage(notification)}</a>
              <p className="metadata">
                {notification.readAt ? "Lida" : "Não lida"} ·{" "}
                <time dateTime={notification.createdAt.toISOString()}>
                  {notification.createdAt.toLocaleString("pt-BR")}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
