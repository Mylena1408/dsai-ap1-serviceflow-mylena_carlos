import Link from "next/link";
import { countUnreadNotifications, type NotificationRecord } from "@/modules/notifications";
import { notificationMessage } from "@/shared/notifications";

// In-app notifications (SPEC 2026-10-31-eventos-outbox-jobs, section 8.2). The text of each
// notification lives in the notifications module, shared with the emails.

export { notificationMessage };

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
  /** "Preferências de notificação" of the area (SPEC 2026-11-01-notificacoes-email-preferencias). */
  preferencesHref: string;
};

export function NotificationList({ notifications, markAllAction, preferencesHref }: NotificationListProps) {
  const unread = notifications.filter(({ readAt }) => readAt === null).length;

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Avisos</p>
          <h1>Notificações</h1>
          <p>{unread === 1 ? "1 não lida" : `${unread} não lidas`} entre as 50 mais recentes.</p>
          <p>
            <Link href={preferencesHref}>Preferências de e-mail</Link>
          </p>
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
