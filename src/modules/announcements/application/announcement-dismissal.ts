import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { assertCanBeDismissed, type AnnouncementRecord } from "../domain/announcement";

// A person dismisses an announcement (SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 4; decision K5; SF-237):
// only an information notice of their audience shown in their strip at the database's instant. Stored once per
// person and announcement; dismissing again changes nothing.

export interface AnnouncementDismissalStore {
  now(): Promise<Date>;
  find(announcementId: string): Promise<AnnouncementRecord | null>;
  /** Stores the dismissal unless it is already there. */
  dismiss(dismissal: { announcementId: string; userId: string; dismissedAt: Date }): Promise<void>;
}

export async function dismissAnnouncement(announcementId: unknown, store: AnnouncementDismissalStore): Promise<void> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, announcementId);
  const [announcement, now] = await Promise.all([store.find(id), store.now()]);
  if (!announcement) throw new NotFoundError();
  assertCanBeDismissed(announcement, { id: actor.id, role: actor.role, sectorId: actor.sectorId }, now);
  await store.dismiss({ announcementId: id, userId: actor.id, dismissedAt: now });
}
