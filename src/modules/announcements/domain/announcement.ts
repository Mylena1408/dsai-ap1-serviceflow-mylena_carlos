import { z } from "zod";
import { ConflictError } from "@/server/errors";
import { calendarDayError, SAO_PAULO_TIME_ZONE, zonedDateTimeOf, zonedInstantOf } from "@/shared/time";
import { entityIdSchema } from "@/shared/validation";

// Announcements and scheduled maintenance (SPEC 2026-11-09-comunicacao-e-calendarios, part A; decisions K2, K5 and
// K6): the administrator announces something to everyone, to a role or to a sector, for a period; a maintenance
// window is announced some hours before it and while it lasts, without blocking anything. The rules 1 and 2 are also
// CHECKs in the database.

export const ANNOUNCEMENT_LEVELS = ["INFO", "WARNING"] as const;
export const ANNOUNCEMENT_KINDS = ["NOTICE", "MAINTENANCE"] as const;
export const ANNOUNCEMENT_AUDIENCES = ["ALL", "ROLE", "SECTOR"] as const;
export const ANNOUNCEMENT_ROLES = ["ADMIN", "MANAGER", "ATTENDANT", "REQUESTER"] as const;

export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export type AnnouncementRole = (typeof ANNOUNCEMENT_ROLES)[number];

export const MAX_ANNOUNCEMENT_TITLE_LENGTH = 80;
export const MAX_ANNOUNCEMENT_BODY_LENGTH = 500;
export const MAX_NOTICE_DAYS = 90;
export const MAX_MAINTENANCE_HOURS = 24;
export const DEFAULT_LEAD_HOURS = 24;
export const MAX_LEAD_HOURS = 168;
/** 3.3 item 3: at most this many announcements at once for a person. */
export const MAX_VISIBLE_ANNOUNCEMENTS = 3;
/** 3.1 item 4: the page "Avisos" shows the ones that ended in the last 90 days. */
export const ANNOUNCEMENT_HISTORY_DAYS = 90;

/** Why a change is refused, so each screen message is its own (SF-235). Still a conflict (409). */
export type AnnouncementConflictReason = "ends_in_past" | "ended" | "not_scheduled" | "not_current" | "start_moved" | "not_dismissable";

export class AnnouncementConflict extends ConflictError {
  constructor(readonly reason: AnnouncementConflictReason) {
    super();
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * A date and time typed in the organization's time zone ("YYYY-MM-DDTHH:MM", as a `datetime-local` field sends it),
 * as an instant; null when it is not a valid one.
 */
export function parseLocalDateTime(value: string, timeZone: string = SAO_PAULO_TIME_ZONE): Date | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const [, day, hours, minutes] = match;
  if (calendarDayError(day!) !== null) return null;
  const hour = Number(hours);
  const minute = Number(minutes);
  if (hour > 23 || minute > 59) return null;
  return zonedInstantOf(day!, hour * 60 + minute, timeZone);
}

/** An empty form field is an absent value. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" || value === null ? undefined : value), schema.optional());
const localDateTimeSchema = z.string().refine((value) => parseLocalDateTime(value) !== null, { message: "invalid_format" });

/**
 * 3.3 items 1 and 2. A maintenance is always a warning (rule 4 never lets it be dismissed), so its level is not
 * asked; a notice has no lead, so a lead sent with it is ignored.
 */
export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_ANNOUNCEMENT_TITLE_LENGTH),
    body: z.string().trim().min(1).max(MAX_ANNOUNCEMENT_BODY_LENGTH),
    kind: z.enum(ANNOUNCEMENT_KINDS),
    level: optional(z.enum(ANNOUNCEMENT_LEVELS)),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    audienceRole: optional(z.enum(ANNOUNCEMENT_ROLES)),
    audienceSectorId: optional(entityIdSchema),
    startsAt: localDateTimeSchema,
    endsAt: localDateTimeSchema,
    leadHours: optional(z.coerce.number().int().min(0).max(MAX_LEAD_HOURS)),
  })
  .strict()
  .superRefine((input, context) => {
    // The field names the problem; the screens have one message per field.
    const issue = (path: string) => context.addIssue({ code: "custom", path: [path], message: path });

    if (input.kind === "NOTICE" && input.level === undefined) issue("level");
    if (input.audience === "ROLE" && input.audienceRole === undefined) issue("audienceRole");
    if (input.audience === "SECTOR" && input.audienceSectorId === undefined) issue("audienceSectorId");

    const startsAt = parseLocalDateTime(input.startsAt);
    const endsAt = parseLocalDateTime(input.endsAt);
    if (!startsAt || !endsAt) return;
    const duration = endsAt.getTime() - startsAt.getTime();
    if (duration <= 0) {
      issue("endsAt");
    } else if (input.kind === "NOTICE" && duration > MAX_NOTICE_DAYS * DAY_MS) {
      issue("endsAt");
    } else if (input.kind === "MAINTENANCE" && duration > MAX_MAINTENANCE_HOURS * HOUR_MS) {
      issue("endsAt");
    }
  })
  .transform(
    (input): AnnouncementData => ({
      title: input.title,
      body: input.body,
      kind: input.kind,
      level: input.kind === "MAINTENANCE" ? "WARNING" : input.level!,
      audience: input.audience,
      // Only the field of the chosen audience is kept (3.3 item 2).
      audienceRole: input.audience === "ROLE" ? input.audienceRole! : null,
      audienceSectorId: input.audience === "SECTOR" ? input.audienceSectorId! : null,
      startsAt: parseLocalDateTime(input.startsAt)!,
      endsAt: parseLocalDateTime(input.endsAt)!,
      leadHours: input.kind === "MAINTENANCE" ? (input.leadHours ?? DEFAULT_LEAD_HOURS) : null,
    }),
  );

export type AnnouncementInput = z.input<typeof announcementInputSchema>;

/** What is stored: the same columns as the table. */
export interface AnnouncementData {
  title: string;
  body: string;
  kind: AnnouncementKind;
  level: AnnouncementLevel;
  audience: AnnouncementAudience;
  audienceRole: AnnouncementRole | null;
  audienceSectorId: string | null;
  startsAt: Date;
  endsAt: Date;
  leadHours: number | null;
}

export interface AnnouncementRecord extends AnnouncementData {
  id: string;
  createdAt: Date;
}

/** Who reads the screens: their role and sector decide the audience (3.3 item 2). */
export interface AnnouncementViewer {
  id: string;
  role: AnnouncementRole;
  sectorId: string | null;
}

/** When the strip starts: the start, or for a maintenance the lead before the window (3.1 item 3). */
export function stripStartsAt(announcement: Pick<AnnouncementData, "kind" | "startsAt" | "leadHours">): Date {
  if (announcement.kind !== "MAINTENANCE") return announcement.startsAt;
  return new Date(announcement.startsAt.getTime() - (announcement.leadHours ?? 0) * HOUR_MS);
}

/** Whether the strip shows at this instant: from its start (with the lead) until the end, the end excluded. */
export function isShownAt(announcement: Pick<AnnouncementData, "kind" | "startsAt" | "endsAt" | "leadHours">, now: Date): boolean {
  return stripStartsAt(announcement).getTime() <= now.getTime() && now.getTime() < announcement.endsAt.getTime();
}

/** 3.3 item 2: everyone, the people of a role, or the people of a sector (of any role). */
export function reaches(announcement: Pick<AnnouncementData, "audience" | "audienceRole" | "audienceSectorId">, viewer: AnnouncementViewer): boolean {
  if (announcement.audience === "ALL") return true;
  if (announcement.audience === "ROLE") return announcement.audienceRole === viewer.role;
  return viewer.sectorId !== null && announcement.audienceSectorId === viewer.sectorId;
}

/** 3.3 item 4 (decision K5): only an "information" notice is dismissed; a warning and a maintenance stay. */
export function canDismiss(announcement: Pick<AnnouncementData, "kind" | "level">): boolean {
  return announcement.kind === "NOTICE" && announcement.level === "INFO";
}

/** Warnings and maintenance first (3.3 item 3). */
function isUrgent(announcement: Pick<AnnouncementData, "kind" | "level">): boolean {
  return announcement.kind === "MAINTENANCE" || announcement.level === "WARNING";
}

/** Urgent first, then the most recent start, then the most recent creation; the id settles a tie. */
export function compareAnnouncements(left: AnnouncementRecord, right: AnnouncementRecord): number {
  return (
    Number(isUrgent(right)) - Number(isUrgent(left)) ||
    right.startsAt.getTime() - left.startsAt.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

/**
 * The strip of a person now (3.3 items 2 to 4): the announcements of their audience shown at this instant, without
 * the ones they dismissed, urgent first, at most three.
 */
export function visibleAnnouncements<T extends AnnouncementRecord>(
  announcements: readonly T[],
  viewer: AnnouncementViewer,
  now: Date,
  dismissedIds: ReadonlySet<string>,
): T[] {
  return announcements
    .filter((announcement) => reaches(announcement, viewer) && isShownAt(announcement, now))
    .filter((announcement) => !(canDismiss(announcement) && dismissedIds.has(announcement.id)))
    .sort(compareAnnouncements)
    .slice(0, MAX_VISIBLE_ANNOUNCEMENTS);
}

/** A maintenance before its window ("programada") or during it ("em andamento"); null for a notice. */
export function maintenancePhase(announcement: Pick<AnnouncementData, "kind" | "startsAt">, now: Date): "scheduled" | "in_progress" | null {
  if (announcement.kind !== "MAINTENANCE") return null;
  return now.getTime() < announcement.startsAt.getTime() ? "scheduled" : "in_progress";
}

/**
 * Where an announcement stands for its administration: before its start (for a maintenance, the window), during
 * it, or ended. The lead of a maintenance is still "scheduled": it may be changed or deleted (cancelled).
 */
export type AnnouncementStatus = "scheduled" | "current" | "ended";

export function announcementStatus(announcement: Pick<AnnouncementData, "startsAt" | "endsAt">, now: Date): AnnouncementStatus {
  if (now.getTime() < announcement.startsAt.getTime()) return "scheduled";
  return now.getTime() < announcement.endsAt.getTime() ? "current" : "ended";
}

/**
 * The page "Avisos" (3.1 item 4): the announcements of the person's audience whose strip has started and that are
 * shown now or ended in the last 90 days; the ones shown now first, then by the most recent start. Dismissed ones
 * stay here.
 */
export function announcementHistory<T extends AnnouncementRecord>(announcements: readonly T[], viewer: AnnouncementViewer, now: Date): T[] {
  const since = now.getTime() - ANNOUNCEMENT_HISTORY_DAYS * DAY_MS;
  return announcements
    .filter((announcement) => reaches(announcement, viewer))
    .filter((announcement) => stripStartsAt(announcement).getTime() <= now.getTime() && announcement.endsAt.getTime() > since)
    .sort(
      (left, right) =>
        Number(isShownAt(right, now)) - Number(isShownAt(left, now)) ||
        right.startsAt.getTime() - left.startsAt.getTime() ||
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
}

/** Creating or changing one needs an end still in the future (an announcement entirely past would show nothing). */
export function assertEndsInFuture(data: Pick<AnnouncementData, "endsAt">, now: Date): void {
  if (data.endsAt.getTime() <= now.getTime()) throw new AnnouncementConflict("ends_in_past");
}

/** 3.3 item 5: an ended announcement does not change any more. */
export function assertCanChange(announcement: Pick<AnnouncementData, "startsAt" | "endsAt">, now: Date): void {
  if (announcementStatus(announcement, now) === "ended") throw new AnnouncementConflict("ended");
}

/** 3.3 item 5: only one that has not started is deleted; it has no dismissals yet. */
export function assertCanDelete(announcement: Pick<AnnouncementData, "startsAt" | "endsAt">, now: Date): void {
  if (announcementStatus(announcement, now) !== "scheduled") throw new AnnouncementConflict("not_scheduled");
}

/** 3.3 item 5: "encerrar antes do fim" moves the end to now; only one that is going on is closed. */
export function closingEnd(announcement: Pick<AnnouncementData, "startsAt" | "endsAt">, now: Date): Date {
  if (announcementStatus(announcement, now) !== "current") throw new AnnouncementConflict("not_current");
  return now;
}

/** 3.3 item 4: a person dismisses an "information" notice shown to them now. */
export function assertCanBeDismissed(announcement: AnnouncementRecord, viewer: AnnouncementViewer, now: Date): void {
  if (!canDismiss(announcement) || !reaches(announcement, viewer) || !isShownAt(announcement, now)) throw new AnnouncementConflict("not_dismissable");
}

/** The value of a `datetime-local` field for an instant, in the organization's time zone ("YYYY-MM-DDTHH:MM"). */
export function toLocalDateTimeInput(instant: Date, timeZone: string = SAO_PAULO_TIME_ZONE): string {
  return zonedDateTimeOf(instant, timeZone).replace(" ", "T");
}

/**
 * Changing one that is going on (SF-235): its start may not move past the instant of the change, or it would be
 * "scheduled" again with dismissals, and could then be deleted.
 */
export function assertStartedStaysStarted(current: Pick<AnnouncementData, "startsAt" | "endsAt">, next: Pick<AnnouncementData, "startsAt">, now: Date): void {
  if (announcementStatus(current, now) === "current" && next.startsAt.getTime() > now.getTime()) throw new AnnouncementConflict("start_moved");
}

/** Names for the screens and the audit trail. */
export const ANNOUNCEMENT_LEVEL_LABELS: Record<AnnouncementLevel, string> = { INFO: "Informação", WARNING: "Atenção" };
export const ANNOUNCEMENT_KIND_LABELS: Record<AnnouncementKind, string> = { NOTICE: "Aviso", MAINTENANCE: "Manutenção" };
export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = { ALL: "Todos", ROLE: "Um perfil", SECTOR: "Um setor" };

/** "20/11/2026 09:00" in the organization's time zone. */
export function formatAnnouncementInstant(instant: Date, timeZone: string = SAO_PAULO_TIME_ZONE): string {
  const [day, time] = zonedDateTimeOf(instant, timeZone).split(" ");
  const [year, month, date] = day!.split("-");
  return `${date}/${month}/${year} ${time}`;
}
