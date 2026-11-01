import { listNotifications } from "@/modules/notifications";
import { NotificationList } from "@/app/_components/notifications";
import { markAllNotificationsAction } from "@/app/_components/notification-actions";
import { requireAttendantPageAccess } from "../../page-access";

export default async function AttendantNotificationsPage() {
  await requireAttendantPageAccess();
  const notifications = await listNotifications();

  return <NotificationList notifications={notifications} markAllAction={markAllNotificationsAction} />;
}
