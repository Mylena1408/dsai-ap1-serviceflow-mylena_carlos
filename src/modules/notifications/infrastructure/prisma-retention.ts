import type { PrismaClient } from "@prisma/client";

// Retention of notifications and email deliveries (SPEC 2026-11-02-auditoria-lgpd, 5.3). Read
// notifications keep their own cleanup (`purgeRead`); these remove what nobody read and the
// delivery records, by the date they were created.

/** Notifications never read, created before `before`; their email deliveries go with them. */
export async function purgeUnreadNotifications(database: PrismaClient, before: Date): Promise<number> {
  const result = await database.requestNotification.deleteMany({ where: { readAt: null, createdAt: { lt: before } } });
  return result.count;
}

/** Email delivery records created before `before`, whatever their situation. */
export async function purgeEmailDeliveries(database: PrismaClient, before: Date): Promise<number> {
  const result = await database.emailDelivery.deleteMany({ where: { createdAt: { lt: before } } });
  return result.count;
}
