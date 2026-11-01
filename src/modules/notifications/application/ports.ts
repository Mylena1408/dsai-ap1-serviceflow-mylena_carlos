import type { NotificationType } from "../domain/recipients";

export interface NotificationRecord {
  id: string;
  requestId: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  serviceName: string;
  /** Stage entered, for "stage.changed" while its event is still kept (SPEC de fluxos, 5.5). */
  stageName?: string;
}

export interface NotificationRequestState {
  requesterId: string;
  sectorId: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  assignee: { id: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT"; isActive: boolean; sectorId: string | null } | null;
}

export interface NotificationStore {
  findRequestState(requestId: string): Promise<NotificationRequestState | null>;
  /** Active attendants of a sector (SLA alerts without an assignee). */
  sectorAttendantIds(sectorId: string): Promise<string[]>;
  /** The subset of `userIds` that are active. */
  activeUserIds(userIds: string[]): Promise<Set<string>>;
  /** Idempotent: an existing (eventId, recipientId) pair is kept as is. */
  insertMany(
    notifications: Array<{ eventId: string; requestId: string; recipientId: string; type: NotificationType; createdAt: Date }>,
  ): Promise<void>;
  countUnread(recipientId: string): Promise<number>;
  listRecent(recipientId: string, limit: number): Promise<NotificationRecord[]>;
  markAllRead(recipientId: string): Promise<void>;
  /** Marks one notification of this recipient as read; returns its request id, or null. */
  markRead(notificationId: string, recipientId: string): Promise<string | null>;
  purgeRead(before: Date): Promise<number>;
}
