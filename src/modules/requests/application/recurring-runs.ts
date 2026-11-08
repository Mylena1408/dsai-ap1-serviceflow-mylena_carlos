import { randomUUID } from "node:crypto";
import { FAILURES_TO_PAUSE, dueOccurrence, type ScheduleTiming, type SkipReason } from "@/modules/recurring-requests";
import { collectFieldAnswers } from "@/modules/service-fields";
import { ConflictError } from "@/server/errors";
import { authorizeRequestRead } from "./attachment-queries";
import { openRequest } from "./create-request";
import type { AttachmentQueryRepository, RequestTransaction } from "./ports";

// Runs of the recurring requests' schedules by the daily job (SPEC 2026-11-07-operacao-e-automacao, 5.3
// item 3). For each active schedule whose latest day up to today has not run, one run of that day: the
// request opens with the rules of the normal opening, checked again now, in the requester's name; when
// something does not match, the run is recorded as not opened with the reason. Three in a row pause the
// schedule. A unique row per schedule and day keeps it to one run even with two jobs at once.

export interface ScheduleForRun extends ScheduleTiming {
  id: string;
  serviceId: string;
  requesterId: string;
  description: string;
  answers: Record<string, string | string[]>;
  pausedAt: Date | null;
  endedAt: Date | null;
  consecutiveFailures: number;
  /** The most recent day with a run, or null. */
  lastRunOn: string | null;
}

export interface RecurringRunTransaction extends RequestTransaction {
  findScheduleForRun(scheduleId: string): Promise<ScheduleForRun | null>;
  insertRecurringRun(run: {
    recurringRequestId: string;
    scheduledOn: string;
    outcome: "OPENED" | "SKIPPED";
    reason: SkipReason | null;
    requestId: string | null;
    occurredAt: Date;
  }): Promise<void>;
  /** The failures in a row after the run and, on the third, the pause by the system. */
  recordRunResult(scheduleId: string, result: { consecutiveFailures: number; pausedAt?: Date }): Promise<void>;
}

export interface RecurringRunStore {
  today(): Promise<string>;
  /** Schedules not ended nor paused, started and not past their end, with their latest run. */
  activeSchedules(today: string): Promise<ScheduleForRun[]>;
  run<T>(work: (transaction: RecurringRunTransaction) => Promise<T>): Promise<T>;
}

export interface RecurringRunSummary {
  opened: number;
  skipped: number;
  /** Schedules paused by this run after three runs in a row that did not open. */
  paused: number;
  /** Runs stopped by an unexpected error: nothing was recorded and the next job tries again. */
  failed: number;
}

type RunOutcome = "opened" | "skipped" | "paused" | "none";

/** CA-REC-05: after its end a schedule opens nothing more, not even a last day the job missed. */
const pastItsEnd = (schedule: Pick<ScheduleForRun, "endsOn">, today: string) => schedule.endsOn !== null && schedule.endsOn < today;

/** Why the request cannot open now, in the order the screen explains it; null when it can. */
async function skipReason(transaction: RequestTransaction, schedule: ScheduleForRun): Promise<SkipReason | null> {
  const service = await transaction.findServiceForRequest(schedule.serviceId);
  if (!service || !service.isActive || !service.category.isActive || !service.sector.isActive) return "SERVICE_UNAVAILABLE";
  const requester = await transaction.findActor(schedule.requesterId);
  if (!requester || !requester.isActive || requester.role !== "REQUESTER") return "REQUESTER_INACTIVE";
  if ((await transaction.listActiveRequirements(schedule.serviceId)).length > 0) return "DOCUMENT_REQUIRED";
  const fields = await transaction.listActiveFields(schedule.serviceId);
  if (!collectFieldAnswers(fields, new Map(Object.entries(schedule.answers))).ok) return "FORM_CHANGED";
  return null;
}

async function runSchedule(transaction: RecurringRunTransaction, scheduleId: string, today: string, day: string): Promise<RunOutcome> {
  // Read again in the transaction: it may have been paused, ended or run since the list was read.
  const schedule = await transaction.findScheduleForRun(scheduleId);
  if (!schedule || schedule.pausedAt || schedule.endedAt || pastItsEnd(schedule, today) || dueOccurrence(schedule, today, schedule.lastRunOn) !== day) {
    return "none";
  }

  const occurredAt = await transaction.currentTime();
  const reason = await skipReason(transaction, schedule);

  if (reason === null) {
    const requestId = randomUUID();
    await openRequest(
      transaction,
      schedule.requesterId,
      { serviceId: schedule.serviceId, description: schedule.description, fieldValues: schedule.answers },
      requestId,
      [],
      null,
      schedule.id,
    );
    await transaction.insertRecurringRun({ recurringRequestId: schedule.id, scheduledOn: day, outcome: "OPENED", reason: null, requestId, occurredAt });
    await transaction.recordRunResult(schedule.id, { consecutiveFailures: 0 });
    return "opened";
  }

  await transaction.insertRecurringRun({ recurringRequestId: schedule.id, scheduledOn: day, outcome: "SKIPPED", reason, requestId: null, occurredAt });
  const failures = schedule.consecutiveFailures + 1;
  const pause = failures >= FAILURES_TO_PAUSE;
  await transaction.recordRunResult(schedule.id, { consecutiveFailures: failures, ...(pause ? { pausedAt: occurredAt } : {}) });
  return pause ? "paused" : "skipped";
}

export async function runRecurringSchedules(store: RecurringRunStore): Promise<RecurringRunSummary> {
  const summary: RecurringRunSummary = { opened: 0, skipped: 0, paused: 0, failed: 0 };
  const today = await store.today();

  for (const schedule of await store.activeSchedules(today)) {
    const day = pastItsEnd(schedule, today) ? null : dueOccurrence(schedule, today, schedule.lastRunOn);
    if (day === null) continue;

    let outcome: RunOutcome;
    try {
      outcome = await store.run((transaction) => runSchedule(transaction, schedule.id, today, day));
    } catch (error) {
      // Another run recorded this day first (the unique row, or a serialization conflict): nothing to do.
      if (error instanceof ConflictError) continue;
      // One schedule's failure does not stop the others.
      summary.failed += 1;
      continue;
    }

    if (outcome === "opened") summary.opened += 1;
    else if (outcome === "skipped") summary.skipped += 1;
    else if (outcome === "paused") {
      summary.skipped += 1;
      summary.paused += 1;
    }
  }

  return summary;
}

/** 5.3 item 4: the name of the schedule that opened a request, for whoever reads it; null otherwise. */
export async function getRequestScheduleName(
  requestId: unknown,
  scope: Pick<AttachmentQueryRepository, "findRequestScope" | "approvalCoverage">,
  findScheduleName: (requestId: string) => Promise<string | null>,
): Promise<string | null> {
  return findScheduleName(await authorizeRequestRead(requestId, scope));
}
