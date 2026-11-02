import type { PrismaClient } from "@prisma/client";
import type { EventConsumer } from "@/modules/events";
import { prisma } from "@/server/db";
import * as useCases from "./application/notification-use-cases";
import * as preferences from "./application/preference-use-cases";
import type { NotificationRecord } from "./application/ports";
import { createPrismaNotificationStore } from "./infrastructure/prisma-notification-store";
import { createPrismaPreferenceStore } from "./infrastructure/prisma-preference-store";

// In-app notifications (SPEC 2026-10-31-eventos-outbox-jobs, section 8).
export { plannedNotifications } from "./domain/recipients";
export type { NotificationType } from "./domain/recipients";
// Email notifications and preferences (SPEC 2026-11-01-notificacoes-email-preferencias).
export {
  EMAIL_DELIVERY_STATUSES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  nextDeliveryState,
  notificationCategory,
  typesOfCategory,
  wantsEmail,
} from "./domain/email";
export type {
  EmailDeliveryOutcome,
  EmailDeliveryState,
  EmailDeliveryStatus,
  EmailSkipReason,
  NotificationCategory,
} from "./domain/email";
export type { NotificationRecord } from "./application/ports";

export function notificationConsumer(database: PrismaClient = prisma): EventConsumer {
  return useCases.createNotificationConsumer(createPrismaNotificationStore(database));
}

export async function countUnreadNotifications(database: PrismaClient = prisma): Promise<number> {
  return useCases.countUnreadNotifications(createPrismaNotificationStore(database));
}

export async function listNotifications(database: PrismaClient = prisma): Promise<NotificationRecord[]> {
  return useCases.listNotifications(createPrismaNotificationStore(database));
}

export async function markAllNotificationsRead(database: PrismaClient = prisma): Promise<void> {
  return useCases.markAllNotificationsRead(createPrismaNotificationStore(database));
}

export async function openNotification(notificationId: unknown, database: PrismaClient = prisma): Promise<string | null> {
  return useCases.openNotification(notificationId, createPrismaNotificationStore(database));
}

/** Deletes notifications read before `before` (daily cleanup, section 7). */
export async function purgeReadNotifications(before: Date, database: PrismaClient = prisma): Promise<number> {
  return createPrismaNotificationStore(database).purgeRead(before);
}

export type { EmailPreferences } from "./application/preference-use-cases";

/** The signed-in person's email choice per category (all off until they choose). */
export async function getEmailPreferences(database: PrismaClient = prisma): Promise<preferences.EmailPreferences> {
  return preferences.getEmailPreferences(createPrismaPreferenceStore(database));
}

/** Turns email on for the categories listed and off for the others, for the signed-in person. */
export async function updateEmailPreferences(input: unknown, database: PrismaClient = prisma): Promise<void> {
  return preferences.updateEmailPreferences(input, createPrismaPreferenceStore(database));
}
