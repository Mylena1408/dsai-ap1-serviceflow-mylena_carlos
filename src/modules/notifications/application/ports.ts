import type { NotificationCategory } from "../domain/email";
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
  approvalState: "PENDING" | "APPROVED" | "REJECTED" | null;
  assignee: { id: string; role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER"; isActive: boolean; sectorId: string | null } | null;
}

export interface NotificationStore {
  findRequestState(requestId: string): Promise<NotificationRequestState | null>;
  /** Active managers of a sector (approval requests, SPEC de aprovações 5.6.3). */
  sectorManagerIds(sectorId: string): Promise<string[]>;
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

/** Email preferences (SPEC 2026-11-01-notificacoes-email-preferencias, 5.1). */
export interface NotificationPreferenceStore {
  /** Categories with email on; a category without a row is off. */
  enabledCategories(userId: string): Promise<Set<NotificationCategory>>;
  /** Writes the choice of every category of this user at once. */
  save(userId: string, choices: Record<NotificationCategory, boolean>, at: Date): Promise<void>;
}
