// Who is notified of each event (SPEC 2026-10-31-eventos-outbox-jobs, section 8.1).
// Pure rules over identifiers; the consumer loads the request state when processing.

export type NotificationType =
  | "status.IN_PROGRESS"
  | "status.COMPLETED"
  | "status.CANCELLED"
  | "status.OPEN"
  | "assignment.received"
  | "comment.public"
  | "comment.internal";

export interface NotificationContext {
  requesterId: string;
  /** Effective assignee now (decision E4: without one, nobody on the team is notified). */
  effectiveAssigneeId: string | null;
}

export type NotifiableEvent =
  | { type: "request.opened" }
  | { type: "request.status_changed"; payload: { toStatus: string; actorId: string } }
  | { type: "request.assignment_changed"; payload: { toAssigneeId: string | null; actorId: string } }
  | { type: "request.comment_added"; payload: { authorId: string; isInternal: boolean } };

export interface PlannedNotification {
  recipientId: string;
  type: NotificationType;
}

const STATUS_TYPES: Record<string, NotificationType> = {
  IN_PROGRESS: "status.IN_PROGRESS",
  COMPLETED: "status.COMPLETED",
  CANCELLED: "status.CANCELLED",
  OPEN: "status.OPEN",
};

function plan(recipientId: string | null, type: NotificationType, actorId: string): PlannedNotification[] {
  // The author of an action is never notified of it.
  return recipientId && recipientId !== actorId ? [{ recipientId, type }] : [];
}

export function plannedNotifications(event: NotifiableEvent, context: NotificationContext): PlannedNotification[] {
  switch (event.type) {
    case "request.opened":
      return [];

    case "request.status_changed": {
      const type = STATUS_TYPES[event.payload.toStatus];
      if (!type) return [];
      // Requesters only cancel or reopen their own request: the assignee hears about it.
      // Any other status change comes from an attendant: the requester hears about it.
      const byRequester = event.payload.actorId === context.requesterId;
      return plan(byRequester ? context.effectiveAssigneeId : context.requesterId, type, event.payload.actorId);
    }

    case "request.assignment_changed":
      // Only a transfer notifies: assuming targets the actor and releasing targets nobody.
      return plan(event.payload.toAssigneeId, "assignment.received", event.payload.actorId);

    case "request.comment_added": {
      const { authorId, isInternal } = event.payload;
      if (isInternal) {
        // Internal notes never reach the requester.
        return plan(context.effectiveAssigneeId, "comment.internal", authorId);
      }
      const recipient = authorId === context.requesterId ? context.effectiveAssigneeId : context.requesterId;
      return plan(recipient, "comment.public", authorId);
    }
  }
}
