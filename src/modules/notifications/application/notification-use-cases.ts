import type { ClaimedEvent, EventConsumer } from "@/modules/events";
import { effectiveAssigneeId } from "@/modules/requests";
import { requireCurrentActor } from "@/server/authorization";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { wantsEmail } from "../domain/email";
import { plannedNotifications, type NotifiableEvent } from "../domain/recipients";
import type { NotificationRecord, NotificationRequestState, NotificationStore } from "./ports";

export const RECENT_NOTIFICATIONS = 50;

// The late stage reaches the same people as the SLA alerts (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.2).
// The rule's warning checks the same "still in the attendance" (SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3).
const SLA_EVENTS = new Set(["request.sla_warning", "request.sla_breached", "request.stage_overdue", "request.escalated"]);

/** SPEC 2026-11-01, section 5.5: the sector team is loaded only when nobody holds the request. */
async function slaRecipients(store: NotificationStore, request: NotificationRequestState, assigneeId: string | null) {
  return {
    requestActive: request.status === "OPEN" || request.status === "IN_PROGRESS",
    sectorAttendantIds: assigneeId ? [] : await store.sectorAttendantIds(request.sectorId),
  };
}

/**
 * First consumer of the outbox (decision E1). Recipients are computed from the current
 * database state; inactive users are skipped; inserts are idempotent per (event, user).
 */
export function createNotificationConsumer(store: NotificationStore): EventConsumer {
  return {
    name: "notifications",
    async handle(event: ClaimedEvent) {
      const request = await store.findRequestState(event.requestId);

      if (!request) {
        return;
      }

      const assigneeId = effectiveAssigneeId({
        requesterId: request.requesterId,
        sectorId: request.sectorId,
        status: "OPEN",
        completedAt: null,
        assignee: request.assignee,
      });
      const planned = plannedNotifications(event as unknown as NotifiableEvent, {
        requesterId: request.requesterId,
        effectiveAssigneeId: assigneeId,
        ...(SLA_EVENTS.has(event.type) ? { slaRecipients: await slaRecipients(store, request, assigneeId) } : {}),
        approvalState: request.approvalState,
        // SPEC 2026-11-06-aprofundamento-configurabilidade, 7.3 item 4: the people the rule warned.
        ...(event.type === "request.escalated" && typeof event.payload.escalationId === "string"
          ? { ruleRecipientIds: (await store.escalationRecipientIds?.(event.payload.escalationId)) ?? [] }
          : {}),
        // SPEC 2026-11-06-escalonamento, 4.5: managers only when this breach escalated the request.
        ...(event.type === "request.sla_breached" && (await store.escalatedAt(event.requestId, event.occurredAt))
          ? { escalationManagerIds: await store.sectorManagerIds(request.sectorId) }
          : {}),
        // SPEC 2026-11-01-aprovacoes, 5.6.3: managers are loaded only when the opening needs them,
        // from the sector of the first level (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3).
        // An opening that required approval has the level copy; before levels, the request's sector.
        ...(event.type === "request.opened" && request.approvalState === "PENDING"
          ? { approvalManagerIds: await approvalDeciders(store, request.approvalSectorIdsSnapshot?.[0] ?? request.sectorId) }
          : {}),
        // 4.3.6: a late level reaches who decides it, named by the event, while still pending.
        ...(event.type === "request.approval_overdue" && typeof event.payload.sectorId === "string" && request.approvalState === "PENDING"
          ? { approvalManagerIds: await approvalDeciders(store, event.payload.sectorId) }
          : {}),
        // 4.3.3: an intermediate approval asks the managers of the next level, named by the event.
        ...(event.type === "request.approval_decided" && typeof event.payload.nextSectorId === "string"
          ? { approvalManagerIds: await approvalDeciders(store, event.payload.nextSectorId) }
          : {}),
        // SPEC 2026-11-03-transferencia-entre-setores, 5.6: the team of the sector named by the event.
        ...(event.type === "request.sector_changed" && typeof event.payload.toSectorId === "string"
          ? { receivingAttendantIds: await store.sectorAttendantIds(event.payload.toSectorId) }
          : {}),
        // SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 item 3 (decision I12).
        ...(store.followers ? { followers: await store.followers(event.requestId, request.sectorId) } : {}),
      });

      if (planned.length === 0) {
        return;
      }

      const active = await store.activeUserIds(planned.map(({ recipientId }) => recipientId));
      const recipients = planned.filter(({ recipientId }) => active.has(recipientId));
      // SPEC 2026-11-01-notificacoes-email-preferencias, 5.2: the preference at this moment decides.
      const emailCategories = recipients.length > 0 ? await store.emailCategories([...active]) : new Map();
      await store.insertMany(
        recipients.map(({ recipientId, type }) => ({
          eventId: event.id,
          requestId: event.requestId,
          recipientId,
          type,
          createdAt: event.occurredAt,
          sendEmail: wantsEmail(type, emailCategories.get(recipientId) ?? new Set()),
        })),
      );
    },
  };
}

/** Section 8.2: only the reader's own notifications. */
export async function countUnreadNotifications(store: NotificationStore): Promise<number> {
  const actor = await requireCurrentActor();
  return store.countUnread(actor.id);
}

export async function listNotifications(store: NotificationStore): Promise<NotificationRecord[]> {
  const actor = await requireCurrentActor();
  return store.listRecent(actor.id, RECENT_NOTIFICATIONS);
}

export async function markAllNotificationsRead(store: NotificationStore): Promise<void> {
  const actor = await requireCurrentActor();
  await store.markAllRead(actor.id);
}

/** Marks the reader's notification as read and returns its request id (null if not theirs). */
export async function openNotification(notificationId: unknown, store: NotificationStore): Promise<string | null> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, notificationId);
  return store.markRead(id, actor.id);
}

/** Managers of the sector and today's substitutes (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5). */
function approvalDeciders(store: NotificationStore, sectorId: string): Promise<string[]> {
  return store.approvalDeciderIds ? store.approvalDeciderIds(sectorId) : store.sectorManagerIds(sectorId);
}
