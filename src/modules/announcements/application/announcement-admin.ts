import type { AuditScope } from "@/modules/audit";
import { requireConfigurationAdministrator } from "@/server/authorization";
import { NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  ANNOUNCEMENT_HISTORY_DAYS,
  announcementInputSchema,
  announcementStatus,
  assertCanChange,
  assertCanDelete,
  assertEndsInFuture,
  assertStartedStaysStarted,
  closingEnd,
  type AnnouncementData,
  type AnnouncementRecord,
  type AnnouncementStatus,
} from "../domain/announcement";

// The administration of announcements (SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 1 and 3.3 items 1, 2
// and 5): only the administrator creates, changes, closes and deletes them, each in the audit trail; the instant
// of each decision is the database's.

export interface AnnouncementAdminItem extends AnnouncementRecord {
  status: AnnouncementStatus;
  audienceSectorName: string | null;
  createdByName: string;
}

export interface AnnouncementAdminOverview {
  announcements: AnnouncementAdminItem[];
  /** The active sectors, for the audience "a sector". */
  sectors: Array<{ id: string; name: string }>;
  now: Date;
}

export interface AnnouncementAdminReader {
  now(): Promise<Date>;
  /** The ones whose end is after `endedSince`, with the audience sector's name and the author's name. */
  list(endedSince: Date): Promise<Array<AnnouncementRecord & { audienceSectorName: string | null; createdByName: string }>>;
  activeSectors(): Promise<Array<{ id: string; name: string }>>;
}

export interface AnnouncementAdminTransaction extends AuditScope {
  now(): Promise<Date>;
  find(announcementId: string): Promise<AnnouncementRecord | null>;
  findSector(sectorId: string): Promise<{ id: string; isActive: boolean } | null>;
  create(data: AnnouncementData & { createdById: string }): Promise<AnnouncementRecord>;
  update(announcementId: string, data: Partial<AnnouncementData>): Promise<AnnouncementRecord>;
  delete(announcementId: string): Promise<{ id: string }>;
}

export interface AnnouncementAdminStore {
  run<T>(work: (transaction: AnnouncementAdminTransaction) => Promise<T>): Promise<T>;
}

const STATUS_ORDER: Record<AnnouncementStatus, number> = { current: 0, scheduled: 1, ended: 2 };
const DAY_MS = 86_400_000;

/** Going on first, then scheduled (the nearest first), then ended (the latest first). */
function adminOrder(left: AnnouncementAdminItem, right: AnnouncementAdminItem): number {
  const status = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  if (status !== 0) return status;
  const byStart = left.startsAt.getTime() - right.startsAt.getTime();
  return (left.status === "scheduled" ? byStart : -byStart) || left.id.localeCompare(right.id);
}

export async function listAnnouncementsForAdmin(reader: AnnouncementAdminReader): Promise<AnnouncementAdminOverview> {
  await requireConfigurationAdministrator();
  const now = await reader.now();
  const [rows, sectors] = await Promise.all([reader.list(new Date(now.getTime() - ANNOUNCEMENT_HISTORY_DAYS * DAY_MS)), reader.activeSectors()]);
  return {
    announcements: rows.map((row) => ({ ...row, status: announcementStatus(row, now) })).sort(adminOrder),
    sectors,
    now,
  };
}

/** 3.3 item 2: the sector of the audience exists and is active. */
async function assertAudienceSector(transaction: AnnouncementAdminTransaction, data: AnnouncementData): Promise<void> {
  if (data.audienceSectorId === null) return;
  const sector = await transaction.findSector(data.audienceSectorId);
  if (!sector?.isActive) throw new ValidationError([{ path: ["audienceSectorId"], code: "invalid_value" }]);
}

export async function createAnnouncement(input: unknown, store: AnnouncementAdminStore): Promise<AnnouncementRecord> {
  const actor = await requireConfigurationAdministrator();
  const data = validateInput(announcementInputSchema, input);

  return store.run(async (transaction) => {
    assertEndsInFuture(data, await transaction.now());
    await assertAudienceSector(transaction, data);
    return transaction.audited({ actor, action: "CREATED", entityType: "ANNOUNCEMENT" }, () => transaction.create({ ...data, createdById: actor.id }));
  });
}

async function existing(transaction: AnnouncementAdminTransaction, announcementId: string): Promise<AnnouncementRecord> {
  const announcement = await transaction.find(announcementId);
  if (!announcement) throw new NotFoundError();
  return announcement;
}

/** Until it ends; one going on keeps its start in the past (SF-235). */
export async function updateAnnouncement(announcementId: unknown, input: unknown, store: AnnouncementAdminStore): Promise<AnnouncementRecord> {
  const actor = await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, announcementId);
  const data = validateInput(announcementInputSchema, input);

  return store.run(async (transaction) => {
    const [current, now] = await Promise.all([existing(transaction, id), transaction.now()]);
    assertCanChange(current, now);
    assertEndsInFuture(data, now);
    assertStartedStaysStarted(current, data, now);
    await assertAudienceSector(transaction, data);
    return transaction.audited({ actor, action: "UPDATED", entityType: "ANNOUNCEMENT", entityId: id }, () => transaction.update(id, data));
  });
}

/** 3.3 item 5: "encerrar antes do fim" moves the end to now; the audit shows the end that changed. */
export async function closeAnnouncement(announcementId: unknown, store: AnnouncementAdminStore): Promise<AnnouncementRecord> {
  const actor = await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, announcementId);

  return store.run(async (transaction) => {
    const [current, now] = await Promise.all([existing(transaction, id), transaction.now()]);
    const endsAt = closingEnd(current, now);
    return transaction.audited({ actor, action: "UPDATED", entityType: "ANNOUNCEMENT", entityId: id }, () => transaction.update(id, { endsAt }));
  });
}

/** 3.3 item 5: only one that has not started; it has no dismissals yet. */
export async function deleteAnnouncement(announcementId: unknown, store: AnnouncementAdminStore): Promise<void> {
  const actor = await requireConfigurationAdministrator();
  const id = validateInput(entityIdSchema, announcementId);

  await store.run(async (transaction) => {
    const [current, now] = await Promise.all([existing(transaction, id), transaction.now()]);
    assertCanDelete(current, now);
    await transaction.audited({ actor, action: "DELETED", entityType: "ANNOUNCEMENT", entityId: id }, () => transaction.delete(id));
  });
}
