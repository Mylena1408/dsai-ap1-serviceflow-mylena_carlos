import { z } from "zod";
import { requireCurrentActor } from "@/server/authorization";
import { NotFoundError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  assertCanChangeEntry,
  assertCanLogTime,
  assertWorkedOnInRange,
  timeEntryInputSchema,
  type TimeActor,
  type TimeEntryRecord,
  type TimedRequest,
} from "../domain/time-entry";

// Logging, changing and removing time (SPEC 2026-11-08-atendimento-dia-a-dia, 5.3 items 1 to 3; decisions I10 and
// I11). Every change writes the history with the values after it; removing only marks the entry.

export interface TimeEntryTransaction {
  findActor(userId: string): Promise<TimeActor | null>;
  findRequest(requestId: string): Promise<TimedRequest | null>;
  findEntry(entryId: string): Promise<TimeEntryRecord | null>;
  /** The organization's day now ("YYYY-MM-DD") and the database's time. */
  today(): Promise<string>;
  currentTime(): Promise<Date>;
  create(entry: { requestId: string; userId: string; workedOn: string; minutes: number; note: string | null }): Promise<TimeEntryRecord>;
  update(entryId: string, data: { workedOn?: string; minutes?: number; note?: string | null; deletedAt?: Date }): Promise<TimeEntryRecord>;
  insertEvent(event: {
    entryId: string;
    requestId: string;
    action: "CREATED" | "UPDATED" | "DELETED";
    workedOn: string;
    minutes: number;
    actorId: string;
    occurredAt: Date;
  }): Promise<void>;
}

export interface TimeEntryStore {
  run<T>(work: (transaction: TimeEntryTransaction) => Promise<T>): Promise<T>;
}

const logSchema = z.object({ requestId: entityIdSchema }).passthrough();

async function loadActor(transaction: TimeEntryTransaction, actorId: string): Promise<TimeActor> {
  const actor = await transaction.findActor(actorId);
  if (!actor) throw new NotFoundError();
  return actor;
}

/** 5.3 items 1 and 2: logs time on a request of the attendant's sector. */
export async function logTime(input: unknown, store: TimeEntryStore): Promise<TimeEntryRecord> {
  const authorized = await requireCurrentActor();
  const { requestId, ...rest } = validateInput(logSchema, input);
  const values = validateInput(timeEntryInputSchema, rest);

  return store.run(async (transaction) => {
    const [actor, request] = await Promise.all([loadActor(transaction, authorized.id), transaction.findRequest(requestId)]);
    if (!request) throw new NotFoundError();
    const occurredAt = await transaction.currentTime();
    assertCanLogTime(actor, request, occurredAt);
    assertWorkedOnInRange(values.workedOn, request.openedOn, await transaction.today());

    const entry = await transaction.create({ requestId, userId: actor.id, ...values });
    await transaction.insertEvent({ entryId: entry.id, requestId, action: "CREATED", workedOn: entry.workedOn, minutes: entry.minutes, actorId: actor.id, occurredAt });
    return entry;
  });
}

/**
 * The entry the person may change: their own, up to 7 days after logging, not removed, on a request they may still
 * log time on (an attendant moved to another sector no longer reaches it).
 */
async function changeableEntry(transaction: TimeEntryTransaction, actor: TimeActor, entryId: string, now: Date) {
  const entry = await transaction.findEntry(entryId);
  if (!entry) throw new NotFoundError();
  assertCanChangeEntry(actor, entry, now);
  const request = await transaction.findRequest(entry.requestId);
  if (!request) throw new NotFoundError();
  assertCanLogTime(actor, request, now);
  return { entry, request };
}

/** 5.3 item 3: changes the day, the duration or the note; a change that changes nothing writes nothing. */
export async function updateTimeEntry(entryId: unknown, input: unknown, store: TimeEntryStore): Promise<TimeEntryRecord> {
  const authorized = await requireCurrentActor();
  const id = validateInput(entityIdSchema, entryId);
  const values = validateInput(timeEntryInputSchema, input);

  return store.run(async (transaction) => {
    const actor = await loadActor(transaction, authorized.id);
    const occurredAt = await transaction.currentTime();
    const { entry, request } = await changeableEntry(transaction, actor, id, occurredAt);
    assertWorkedOnInRange(values.workedOn, request.openedOn, await transaction.today());
    if (entry.workedOn === values.workedOn && entry.minutes === values.minutes && entry.note === values.note) return entry;

    const updated = await transaction.update(id, values);
    await transaction.insertEvent({
      entryId: id,
      requestId: entry.requestId,
      action: "UPDATED",
      workedOn: updated.workedOn,
      minutes: updated.minutes,
      actorId: actor.id,
      occurredAt,
    });
    return updated;
  });
}

/** 5.3 item 3 (decision I11): removing marks the entry; its history stays. */
export async function deleteTimeEntry(entryId: unknown, store: TimeEntryStore): Promise<void> {
  const authorized = await requireCurrentActor();
  const id = validateInput(entityIdSchema, entryId);

  await store.run(async (transaction) => {
    const actor = await loadActor(transaction, authorized.id);
    const occurredAt = await transaction.currentTime();
    const { entry } = await changeableEntry(transaction, actor, id, occurredAt);
    await transaction.update(id, { deletedAt: occurredAt });
    await transaction.insertEvent({
      entryId: id,
      requestId: entry.requestId,
      action: "DELETED",
      workedOn: entry.workedOn,
      minutes: entry.minutes,
      actorId: actor.id,
      occurredAt,
    });
  });
}
