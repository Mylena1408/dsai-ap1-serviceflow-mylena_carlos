import type { EmailDeliveryState, NotificationCategory } from "../domain/email";
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
  /** Categories with email on, per user (SPEC 2026-11-01-notificacoes-email-preferencias, 5.2). */
  emailCategories(userIds: string[]): Promise<Map<string, Set<NotificationCategory>>>;
  /**
   * Idempotent: an existing (eventId, recipientId) pair is kept as is. In the same operation, a
   * pending email delivery is created for each newly inserted notification with `sendEmail`.
   */
  insertMany(
    notifications: Array<{
      eventId: string;
      requestId: string;
      recipientId: string;
      type: NotificationType;
      createdAt: Date;
      sendEmail: boolean;
    }>,
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

/** One email to send (SPEC 2026-11-01-notificacoes-email-preferencias, 5.3). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends one email or throws; errors carry a short `code`, never the provider response. */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export interface PendingEmailDelivery extends EmailDeliveryState {
  id: string;
  /** Read at sending time: the current address, state and profile (5.3.4). */
  recipient: { email: string; isActive: boolean; role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER" };
  notification: { type: NotificationType; requestId: string; serviceName: string; stageName?: string };
}

export interface EmailDeliveryStore {
  /** Reserves up to `limit` pending deliveries that are due, skipping those another run holds. */
  claimPending(limit: number, leaseMs: number): Promise<{ deliveries: PendingEmailDelivery[]; now: Date }>;
  save(deliveryId: string, state: EmailDeliveryState): Promise<void>;
}
