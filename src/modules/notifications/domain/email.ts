import { MAX_EVENT_ATTEMPTS, retryDelayMs } from "@/modules/events";
import type { NotificationType } from "./recipients";

// Email notifications (SPEC 2026-11-01-notificacoes-email-preferencias, sections 5.1 to 5.3).
// Pure rules: the category of each notification type and the life of one delivery.

export const NOTIFICATION_CATEGORIES = ["STATUS", "ASSIGNMENT", "COMMENTS", "SLA", "STAGES", "APPROVALS"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Table 5.1. Keyed by every notification type, so a new type without a category fails the
 * typecheck (and the unit test that compares it with the table).
 */
const TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  "status.IN_PROGRESS": "STATUS",
  "status.COMPLETED": "STATUS",
  "status.CANCELLED": "STATUS",
  "status.OPEN": "STATUS",
  "assignment.received": "ASSIGNMENT",
  "comment.public": "COMMENTS",
  "comment.internal": "COMMENTS",
  "sla.warning": "SLA",
  "sla.breached": "SLA",
  "stage.changed": "STAGES",
  "approval.requested": "APPROVALS",
  "approval.approved": "APPROVALS",
  "approval.rejected": "APPROVALS",
};

export const NOTIFICATION_TYPES = Object.keys(TYPE_CATEGORY) as NotificationType[];

export function notificationCategory(type: NotificationType): NotificationCategory {
  return TYPE_CATEGORY[type];
}

export function typesOfCategory(category: NotificationCategory): NotificationType[] {
  return NOTIFICATION_TYPES.filter((type) => TYPE_CATEGORY[type] === category);
}

/** 5.1.2 and 5.2.1: everything starts off; only categories the person turned on send email. */
export function wantsEmail(type: NotificationType, enabledCategories: ReadonlySet<NotificationCategory>): boolean {
  return enabledCategories.has(TYPE_CATEGORY[type]);
}

export const EMAIL_DELIVERY_STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

/**
 * 5.3.2 and 5.2.4: why a delivery was not sent. Recorded as its code, never retried. A person
 * whose profile changed to one without notification pages (administrator) has no link to follow.
 */
export type EmailSkipReason = "not_configured" | "recipient_inactive" | "recipient_without_area";

export type EmailDeliveryOutcome =
  | { kind: "sent" }
  | { kind: "failed"; code: string }
  | { kind: "skipped"; reason: EmailSkipReason };

export interface EmailDeliveryState {
  status: EmailDeliveryStatus;
  attempts: number;
  availableAt: Date;
  sentAt: Date | null;
  lastErrorCode: string | null;
}

/**
 * 5.3.3: the state after one processing of a pending delivery. Failures wait like outbox events
 * and become final after the same number of attempts; a skip is final and is not an attempt.
 */
export function nextDeliveryState(current: EmailDeliveryState, outcome: EmailDeliveryOutcome, now: Date): EmailDeliveryState {
  if (current.status !== "PENDING") {
    throw new Error(`Email delivery is already ${current.status}.`);
  }

  switch (outcome.kind) {
    case "sent":
      return { ...current, status: "SENT", attempts: current.attempts + 1, sentAt: now, lastErrorCode: null };

    case "skipped":
      return { ...current, status: "SKIPPED", lastErrorCode: outcome.reason };

    case "failed": {
      const attempts = current.attempts + 1;
      if (attempts >= MAX_EVENT_ATTEMPTS) {
        return { ...current, status: "FAILED", attempts, lastErrorCode: outcome.code };
      }
      return {
        ...current,
        attempts,
        availableAt: new Date(now.getTime() + retryDelayMs(attempts)),
        lastErrorCode: outcome.code,
      };
    }
  }
}
