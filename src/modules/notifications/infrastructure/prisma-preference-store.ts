import type { PrismaClient } from "@prisma/client";
import type { NotificationCategory } from "../domain/email";
import type { NotificationPreferenceStore } from "../application/ports";

export function createPrismaPreferenceStore(database: PrismaClient): NotificationPreferenceStore {
  return {
    async enabledCategories(userId) {
      const rows = await database.notificationPreference.findMany({
        where: { userId, emailEnabled: true },
        select: { category: true },
      });
      return new Set(rows.map(({ category }) => category));
    },
    async save(userId, choices, at) {
      await database.$transaction(
        (Object.entries(choices) as Array<[NotificationCategory, boolean]>).map(([category, emailEnabled]) =>
          database.notificationPreference.upsert({
            where: { userId_category: { userId, category } },
            create: { userId, category, emailEnabled, updatedAt: at },
            update: { emailEnabled, updatedAt: at },
          }),
        ),
      );
    },
  };
}
