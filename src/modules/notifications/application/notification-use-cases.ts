import type { ClaimedEvent, EventConsumer } from "@/modules/events";
import { effectiveAssigneeId } from "@/modules/requests";
import { requireCurrentActor } from "@/server/authorization";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { plannedNotifications, type NotifiableEvent } from "../domain/recipients";
import type { NotificationRecord, NotificationRequestState, NotificationStore } from "./ports";

export const RECENT_NOTIFICATIONS = 50;

const SLA_EVENTS = new Set(["request.sla_warning", "request.sla_breached"]);

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
      });

      if (planned.length === 0) {
        return;
      }

      const active = await store.activeUserIds(planned.map(({ recipientId }) => recipientId));
      await store.insertMany(
        planned
          .filter(({ recipientId }) => active.has(recipientId))
          .map(({ recipientId, type }) => ({
            eventId: event.id,
            requestId: event.requestId,
            recipientId,
            type,
            createdAt: event.occurredAt,
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
