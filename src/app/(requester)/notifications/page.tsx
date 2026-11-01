import { listNotifications } from "@/modules/notifications";
import { NotificationList } from "@/app/_components/notifications";
import { markAllNotificationsAction } from "@/app/_components/notification-actions";
import { requireRequesterPageAccess } from "../page-access";

export default async function RequesterNotificationsPage() {
  await requireRequesterPageAccess();
  const notifications = await listNotifications();

  return <NotificationList notifications={notifications} markAllAction={markAllNotificationsAction} />;
}
