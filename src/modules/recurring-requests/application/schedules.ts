import type { AuditScope } from "@/modules/audit";
import { assertFieldAnswers, collectFieldAnswers, type AnswerableField } from "@/modules/service-fields";
import { requireCurrentActor } from "@/server/authorization";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { entityIdSchema } from "@/shared/validation";
import {
  assertScheduleRoom,
  inScheduleScope,
  requesterSchedulable,
  scheduleActions,
  scheduleScopeOf,
  serviceSchedulable,
  type ScheduleAction,
  type ScheduleRequester,
  type ScheduleScope,
  type ScheduleServiceState,
} from "../domain/management";
import {
  assertScheduleDates,
  nextOccurrence,
  scheduleInputSchema,
  scheduleStatus,
  type ScheduleInput,
  type ScheduleTiming,
  type SkipReason,
} from "../domain/schedule";

// Schedules of recurring requests (SPEC 2026-11-07-operacao-e-automacao, 5.3 items 1, 2 and 4): the
// administrator for any service and a manager for the services of their sector create, change, pause,
// resume and end them; every change goes to the audit trail. The job's runs arrive in SF-186.

export const RECENT_RUNS = 5;

export interface ScheduleRun {
  scheduledOn: string;
  outcome: "OPENED" | "SKIPPED";
  reason: SkipReason | null;
  requestId: string | null;
}

export interface ScheduleRecord extends ScheduleTiming {
  id: string;
  name: string;
  description: string;
  answers: Record<string, string | string[]>;
  service: { id: string; name: string; sectorId: string; sectorName: string };
  requester: { id: string; name: string };
  createdBy: { id: string; name: string };
  pausedAt: Date | null;
  endedAt: Date | null;
  consecutiveFailures: number;
  /** The most recent runs first, at most RECENT_RUNS. */
  runs: ScheduleRun[];
}

export interface ScheduleView extends ScheduleRecord {
  status: ReturnType<typeof scheduleStatus>;
  /** The next day the job will open a request, while the schedule is active. */
  nextOn: string | null;
  actions: ScheduleAction[];
}

/** A field of the service's opening form, as the schedule form shows it. */
export type ScheduleField = AnswerableField & { helpText: string | null };

export interface ScheduleOverview {
  today: string;
  schedules: ScheduleView[];
  /** The services the person may schedule now, by name. */
  services: Array<Pick<ScheduleServiceState, "id" | "name" | "sectorName">>;
  /** Active requesters, by name. */
  requesters: Array<{ id: string; name: string }>;
}

export interface ScheduleReader {
  today(): Promise<string>;
  listSchedules(scope: ScheduleScope): Promise<ScheduleRecord[]>;
  serviceStates(scope: ScheduleScope): Promise<ScheduleServiceState[]>;
  requesters(): Promise<Array<{ id: string; name: string }>>;
  serviceState(serviceId: string): Promise<ScheduleServiceState | null>;
  activeFields(serviceId: string): Promise<ScheduleField[]>;
}

export interface ScheduleState {
  id: string;
  serviceSectorId: string;
  startsOn: string;
  endsOn: string | null;
  pausedAt: Date | null;
  endedAt: Date | null;
}

export interface ScheduleTransaction extends AuditScope {
  today(): Promise<string>;
  now(): Promise<Date>;
  serviceState(serviceId: string): Promise<ScheduleServiceState | null>;
  requester(userId: string): Promise<ScheduleRequester | null>;
  activeFields(serviceId: string): Promise<AnswerableField[]>;
  /** Schedules not ended and not past their end, other than `exceptId`. */
  countInForce(today: string, exceptId: string | null): Promise<number>;
  findSchedule(scheduleId: string): Promise<ScheduleState | null>;
  create(input: ScheduleInput & { createdById: string }): Promise<{ id: string }>;
  update(scheduleId: string, data: Partial<ScheduleInput> & { pausedAt?: Date | null; endedAt?: Date; consecutiveFailures?: number }): Promise<{ id: string }>;
}

export interface ScheduleStore {
  run<T>(work: (transaction: ScheduleTransaction) => Promise<T>): Promise<T>;
}

function viewOf(record: ScheduleRecord, today: string): ScheduleView {
  const status = scheduleStatus(record, today);
  return {
    ...record,
    status,
    nextOn: status === "active" ? nextOccurrence(record, today) : null,
    actions: scheduleActions(status),
  };
}

export async function listScheduleOverview(reader: ScheduleReader): Promise<ScheduleOverview> {
  const scope = scheduleScopeOf(await requireCurrentActor());
  const [today, schedules, services, requesters] = await Promise.all([
    reader.today(),
    reader.listSchedules(scope),
    reader.serviceStates(scope),
    reader.requesters(),
  ]);
  return {
    today,
    schedules: schedules.map((record) => viewOf(record, today)),
    services: services.filter(serviceSchedulable).map(({ id, name, sectorName }) => ({ id, name, sectorName })),
    requesters,
  };
}

/** The opening form's fields of a service the person may schedule (for the form, 5.3 item 2). */
export async function listScheduleServiceFields(serviceId: unknown, reader: ScheduleReader): Promise<ScheduleField[]> {
  const scope = scheduleScopeOf(await requireCurrentActor());
  const id = validateInput(entityIdSchema, serviceId);
  const service = await reader.serviceState(id);
  if (!service || !inScheduleScope(scope, service.sectorId) || !serviceSchedulable(service)) {
    throw new NotFoundError();
  }
  return reader.activeFields(id);
}

/**
 * 5.3 item 2, checked when saving: the service in the person's scope and schedulable, the requester
 * active with the Requester profile, and the answers exactly as the opening checks them now.
 */
async function assertScheduleContent(transaction: ScheduleTransaction, scope: ScheduleScope, input: ScheduleInput): Promise<void> {
  const service = await transaction.serviceState(input.serviceId);
  if (!service || !inScheduleScope(scope, service.sectorId)) {
    throw new NotFoundError();
  }
  if (!serviceSchedulable(service)) {
    throw new ValidationError([{ path: ["serviceId"], code: "invalid_value" }]);
  }
  if (!requesterSchedulable(await transaction.requester(input.requesterId))) {
    throw new ValidationError([{ path: ["requesterId"], code: "invalid_value" }]);
  }
  const fields = await transaction.activeFields(input.serviceId);
  assertFieldAnswers(collectFieldAnswers(fields, new Map(Object.entries(input.answers))));
}

export async function createSchedule(input: unknown, store: ScheduleStore): Promise<{ id: string }> {
  const actor = await requireCurrentActor();
  const scope = scheduleScopeOf(actor);
  const schedule = validateInput(scheduleInputSchema, input);

  return store.run(async (transaction) => {
    const today = await transaction.today();
    assertScheduleDates(schedule, today);
    await assertScheduleContent(transaction, scope, schedule);
    assertScheduleRoom(await transaction.countInForce(today, null));
    return transaction.audited({ actor, action: "CREATED", entityType: "RECURRING_REQUEST" }, () =>
      transaction.create({ ...schedule, createdById: actor.id }),
    );
  });
}

/** A schedule the person may change: in their scope (by its current service) and not ended. */
async function changeableSchedule(transaction: ScheduleTransaction, scope: ScheduleScope, scheduleId: string): Promise<ScheduleState> {
  const schedule = await transaction.findSchedule(scheduleId);
  if (!schedule || !inScheduleScope(scope, schedule.serviceSectorId)) {
    throw new NotFoundError();
  }
  const status = scheduleStatus(schedule, await transaction.today());
  if (status === "ended" || status === "finished") {
    throw new ConflictError();
  }
  return schedule;
}

/**
 * Everything may change; the content is checked again as on creation. A start already past may stay as
 * it was (it is checked only when it changes), so a running schedule can be edited.
 */
export async function updateSchedule(id: unknown, input: unknown, store: ScheduleStore): Promise<{ id: string }> {
  const actor = await requireCurrentActor();
  const scope = scheduleScopeOf(actor);
  const scheduleId = validateInput(entityIdSchema, id);
  const schedule = validateInput(scheduleInputSchema, input);

  return store.run(async (transaction) => {
    const current = await changeableSchedule(transaction, scope, scheduleId);
    const today = await transaction.today();
    assertScheduleDates(schedule, schedule.startsOn === current.startsOn && current.startsOn < today ? current.startsOn : today);
    await assertScheduleContent(transaction, scope, schedule);
    return transaction.audited({ actor, action: "UPDATED", entityType: "RECURRING_REQUEST", entityId: scheduleId }, () =>
      transaction.update(scheduleId, schedule),
    );
  });
}

export type ScheduleStateChange = "pause" | "resume" | "end";

/**
 * Pausing stops the runs until it is resumed; resuming also clears the failures in a row (5.3 item 3);
 * ending is final. A change that does not apply to the current state is a conflict.
 */
export async function changeScheduleState(id: unknown, change: ScheduleStateChange, store: ScheduleStore): Promise<void> {
  const actor = await requireCurrentActor();
  const scope = scheduleScopeOf(actor);
  const scheduleId = validateInput(entityIdSchema, id);

  await store.run(async (transaction) => {
    const schedule = await changeableSchedule(transaction, scope, scheduleId);
    const paused = schedule.pausedAt !== null;
    if ((change === "pause" && paused) || (change === "resume" && !paused)) {
      throw new ConflictError();
    }
    const now = await transaction.now();
    const data =
      change === "pause" ? { pausedAt: now } : change === "resume" ? { pausedAt: null, consecutiveFailures: 0 } : { endedAt: now };
    await transaction.audited({ actor, action: "UPDATED", entityType: "RECURRING_REQUEST", entityId: scheduleId }, () =>
      transaction.update(scheduleId, data),
    );
  });
}
