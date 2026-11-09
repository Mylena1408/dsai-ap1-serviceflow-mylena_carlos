import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import { canChangeEntry, timeTotals, type TimeActor, type TimeEntryRecord, type TimedRequest } from "../domain/time-entry";

// A request's time (SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 2 and 13.2 item 1; decision I9): the team reads
// the entries, the total, the total by person and the service's estimate; the history shows each change. The
// requester never sees it.

export interface TimeEntryView extends TimeEntryRecord {
  userName: string;
  /** Whether the reader still changes or removes it (5.3 item 3). */
  canChange: boolean;
}

export interface TimeEventView {
  id: string;
  occurredAt: Date;
  action: "CREATED" | "UPDATED" | "DELETED";
  workedOn: string;
  minutes: number;
  actorName: string;
}

export interface RequestTimeView {
  /** The entries not removed, newest day first. */
  entries: TimeEntryView[];
  totalMinutes: number;
  byPerson: Array<{ userId: string; name: string; minutes: number }>;
  /** The service's estimate in hours, when it has one (13.2 item 1). */
  estimatedHours: number | null;
  events: TimeEventView[];
  /** Whether the reader logs time on it now (5.3 item 1). */
  canLog: boolean;
  /** The opening day and today, the range of days an entry may take. */
  openedOn: string;
  today: string;
}

export interface RequestTimeReader {
  findRequest(requestId: string): Promise<(TimedRequest & { estimatedHours: number | null }) | null>;
  entries(requestId: string): Promise<Array<TimeEntryRecord & { userName: string }>>;
  events(requestId: string): Promise<TimeEventView[]>;
  today(): Promise<string>;
  now(): Promise<Date>;
}

/** The team of the request's sector: its attendants and its manager. Anyone else is told it does not exist. */
function assertTeamReader(actor: TimeActor, request: TimedRequest): void {
  if (!actor.isActive || (actor.role !== "ATTENDANT" && actor.role !== "MANAGER") || actor.sectorId !== request.sectorId) {
    throw new NotFoundError();
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getRequestTime(requestId: unknown, reader: RequestTimeReader): Promise<RequestTimeView> {
  const actor = await requireCurrentActor();
  const id = validateInput(entityIdSchema, requestId);
  const request = await reader.findRequest(id);
  if (!request) throw new NotFoundError();
  assertTeamReader(actor, request);

  const [rows, events, today, now] = await Promise.all([reader.entries(id), reader.events(id), reader.today(), reader.now()]);
  const live = rows.filter((entry) => entry.deletedAt === null);
  const { total, byUser } = timeTotals(live);
  const names = new Map(live.map((entry) => [entry.userId, entry.userName]));
  const canLog =
    actor.role === "ATTENDANT" &&
    request.status !== "CANCELLED" &&
    (request.status !== "COMPLETED" || (request.completedAt !== null && now.getTime() - request.completedAt.getTime() <= 7 * DAY_MS));

  return {
    entries: live
      .map((entry) => ({ ...entry, canChange: canLog && canChangeEntry(actor.id, entry, now) }))
      .sort((left, right) => right.workedOn.localeCompare(left.workedOn) || right.createdAt.getTime() - left.createdAt.getTime()),
    totalMinutes: total,
    byPerson: [...byUser.entries()]
      .map(([userId, minutes]) => ({ userId, name: names.get(userId) ?? "—", minutes }))
      .sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name)),
    estimatedHours: request.estimatedHours,
    events,
    canLog,
    openedOn: request.openedOn,
    today,
  };
}
