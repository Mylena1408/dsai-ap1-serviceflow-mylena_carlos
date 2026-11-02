// Who is notified of each event (SPEC 2026-10-31-eventos-outbox-jobs, section 8.1).
// Pure rules over identifiers; the consumer loads the request state when processing.

import type { NotificationType } from "@/shared/notifications";

export type { NotificationType };

export interface NotificationContext {
  requesterId: string;
  /** Effective assignee now (decision E4: without one, nobody on the team is notified). */
  effectiveAssigneeId: string | null;
  /**
   * SLA alerts only (SPEC 2026-11-01, section 5.5): whether the request is still open or in
   * progress, and the active attendants of its sector, used when nobody holds it.
   */
  slaRecipients?: { requestActive: boolean; sectorAttendantIds: readonly string[] };
  /** Approval state of the request now (SPEC 2026-11-01-aprovacoes). */
  approvalState?: "PENDING" | "APPROVED" | "REJECTED" | null;
  /** Active managers of the sector, loaded only for an opening that requires approval. */
  approvalManagerIds?: readonly string[];
}

export type NotifiableEvent =
  | { type: "request.opened" }
  | { type: "request.status_changed"; payload: { toStatus: string; actorId: string } }
  | { type: "request.assignment_changed"; payload: { toAssigneeId: string | null; actorId: string } }
  | { type: "request.comment_added"; payload: { authorId: string; isInternal: boolean } }
  | { type: "request.priority_changed" }
  | { type: "request.sla_warning" }
  | { type: "request.sla_breached" }
  | { type: "request.stage_changed"; payload: { direction: string; actorId: string } }
  | { type: "request.approval_decided"; payload: { decision: string; actorId: string } };

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
      // SPEC 2026-11-01-aprovacoes, 5.6.3: an opening that requires approval reaches the sector managers.
      return (context.approvalManagerIds ?? []).map((recipientId) => ({ recipientId, type: "approval.requested" }));

    case "request.priority_changed":
      return [];

    case "request.status_changed": {
      const type = STATUS_TYPES[event.payload.toStatus];
      if (!type) return [];
      // A rejection also cancels the request; the requester hears about it once, as a rejection.
      if (event.payload.toStatus === "CANCELLED" && context.approvalState === "REJECTED") return [];
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

    case "request.sla_warning":
    case "request.sla_breached": {
      // Exception to E4: a deadline without an owner goes to the whole sector team.
      const sla = context.slaRecipients;
      if (!sla?.requestActive) return [];
      const type: NotificationType = event.type === "request.sla_warning" ? "sla.warning" : "sla.breached";
      const recipients = context.effectiveAssigneeId ? [context.effectiveAssigneeId] : sla.sectorAttendantIds;
      return recipients.map((recipientId) => ({ recipientId, type }));
    }

    case "request.approval_decided":
      return plan(
        context.requesterId,
        event.payload.decision === "APPROVED" ? "approval.approved" : "approval.rejected",
        event.payload.actorId,
      );

    case "request.stage_changed":
      // SPEC 2026-11-01-fluxos-configuraveis, 5.5.3 (decision W4): the requester hears about each
      // move; entering the first stage comes with the start, which already notifies.
      if (event.payload.direction === "start") return [];
      return plan(context.requesterId, "stage.changed", event.payload.actorId);

    default:
      // Event types this consumer does not know about notify nobody.
      return [];
  }
}
