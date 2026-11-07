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
  /** SPEC 2026-11-06-escalonamento, 4.5: active managers of the sector when the breach escalated it. */
  escalationManagerIds?: readonly string[];
  /** Approval state of the request now (SPEC 2026-11-01-aprovacoes). */
  approvalState?: "PENDING" | "APPROVED" | "REJECTED" | null;
  /**
   * Active managers of the sector of the level to decide: the first level for an opening, the next
   * level for an intermediate approval (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3).
   */
  approvalManagerIds?: readonly string[];
  /**
   * Active attendants of the sector that received the request, loaded only for a move to another
   * sector (SPEC 2026-11-03-transferencia-entre-setores, 5.6).
   */
  receivingAttendantIds?: readonly string[];
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
  | { type: "request.approval_decided"; payload: { decision: string; actorId: string; nextSectorId?: string | null } }
  | { type: "request.sector_changed"; payload: { toSectorId: string; actorId: string } }
  | { type: "request.document_added"; payload: { actorId: string } }
  | { type: "request.sla_paused"; payload: { actorId: string } };

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
      const planned = recipients.map((recipientId): PlannedNotification => ({ recipientId, type }));
      // SPEC 2026-11-06-escalonamento, 4.5: the managers hear about an escalated breach, in addition.
      if (event.type === "request.sla_breached") {
        for (const recipientId of context.escalationManagerIds ?? []) {
          if (!planned.some((item) => item.recipientId === recipientId)) planned.push({ recipientId, type: "sla.escalated" });
        }
      }
      return planned;
    }

    case "request.approval_decided": {
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3: an approval with a next level is
      // not the end; the managers of the next level are asked, and the requester waits for the end.
      if (event.payload.decision === "APPROVED" && event.payload.nextSectorId) {
        return (context.approvalManagerIds ?? [])
          .filter((recipientId) => recipientId !== event.payload.actorId)
          .map((recipientId): PlannedNotification => ({ recipientId, type: "approval.requested" }));
      }
      return plan(
        context.requesterId,
        event.payload.decision === "APPROVED" ? "approval.approved" : "approval.rejected",
        event.payload.actorId,
      );
    }

    case "request.sector_changed": {
      // SPEC 2026-11-03-transferencia-entre-setores, 5.6: the receiving team and the requester; the
      // author of the move never.
      const actorId = event.payload.actorId;
      const team = (context.receivingAttendantIds ?? [])
        .filter((recipientId) => recipientId !== actorId)
        .map((recipientId): PlannedNotification => ({ recipientId, type: "sector.received" }));
      return [...team, ...plan(context.requesterId, "sector.changed", actorId)];
    }

    case "request.document_added":
      // SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.6 (decision X7): the effective assignee,
      // like a public comment of the requester; without one, nobody.
      return plan(context.effectiveAssigneeId, "document.added", event.payload.actorId);

    case "request.sla_paused":
      // SPEC 2026-11-03-pausa-sla-calendario, 5.6: the requester is asked to reply; the resume
      // notifies nobody (the requester's reply already notifies the assignee).
      return plan(context.requesterId, "sla.paused", event.payload.actorId);

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
