import type { NotificationType } from "../domain/recipients";

export interface NotificationRecord {
  id: string;
  requestId: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  serviceName: string;
}

export interface NotificationRequestState {
  requesterId: string;
  sectorId: string;
  assignee: { id: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT"; isActive: boolean; sectorId: string | null } | null;
}

export interface NotificationStore {
  findRequestState(requestId: string): Promise<NotificationRequestState | null>;
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
