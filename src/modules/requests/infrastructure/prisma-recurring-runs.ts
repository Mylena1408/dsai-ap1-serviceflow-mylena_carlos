import type { Prisma, PrismaClient } from "@prisma/client";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { RecurringRunStore, RecurringRunTransaction, ScheduleForRun } from "../application/recurring-runs";
import { REQUEST_TRANSACTION_TIMEOUT_MS, createPrismaRequestTransaction } from "./prisma-request-repository";

// The schedules' runs in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 5.3 item 3 and 5.4). Each run
// is one serializable transaction with the opening; the unique row per schedule and day turns a second
// run of the same day into a conflict, which the job ignores.

type Client = PrismaClient | Prisma.TransactionClient;

const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

const scheduleColumns = {
  id: true,
  serviceId: true,
  requesterId: true,
  description: true,
  answers: true,
  frequency: true,
  weekdays: true,
  monthDay: true,
  startsOn: true,
  endsOn: true,
  pausedAt: true,
  endedAt: true,
  consecutiveFailures: true,
  runs: { orderBy: { scheduledOn: "desc" }, take: 1, select: { scheduledOn: true } },
} satisfies Prisma.RecurringRequestSelect;

type ScheduleRow = Prisma.RecurringRequestGetPayload<{ select: typeof scheduleColumns }>;

function answersOf(value: Prisma.JsonValue): Record<string, string | string[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") answers[key] = item;
    else if (Array.isArray(item)) answers[key] = item.filter((entry): entry is string => typeof entry === "string");
  }
  return answers;
}

function scheduleOf(row: ScheduleRow): ScheduleForRun {
  return {
    id: row.id,
    serviceId: row.serviceId,
    requesterId: row.requesterId,
    description: row.description,
    answers: answersOf(row.answers),
    frequency: row.frequency,
    weekdays: row.weekdays,
    monthDay: row.monthDay,
    startsOn: dayOf(row.startsOn),
    endsOn: row.endsOn ? dayOf(row.endsOn) : null,
    pausedAt: row.pausedAt,
    endedAt: row.endedAt,
    consecutiveFailures: row.consecutiveFailures,
    lastRunOn: row.runs[0] ? dayOf(row.runs[0].scheduledOn) : null,
  };
}

function transactionOf(client: Prisma.TransactionClient): RecurringRunTransaction {
  return {
    ...createPrismaRequestTransaction(client),
    async findScheduleForRun(scheduleId) {
      const row = await client.recurringRequest.findUnique({ where: { id: scheduleId }, select: scheduleColumns });
      return row && scheduleOf(row);
    },
    async insertRecurringRun(run) {
      await client.recurringRequestRun.create({ data: { ...run, scheduledOn: dateOf(run.scheduledOn) } });
    },
    async recordRunResult(scheduleId, result) {
      await client.recurringRequest.update({ where: { id: scheduleId }, data: result });
    },
  };
}

async function activeSchedules(client: Client, today: string): Promise<ScheduleForRun[]> {
  const rows = await client.recurringRequest.findMany({
    where: { endedAt: null, pausedAt: null, startsOn: { lte: dateOf(today) }, OR: [{ endsOn: null }, { endsOn: { gte: dateOf(today) } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: scheduleColumns,
  });
  return rows.map(scheduleOf);
}

export function createPrismaRecurringRunStore(database: PrismaClient): RecurringRunStore {
  return {
    today: () => organizationToday(database),
    activeSchedules: (today) => activeSchedules(database, today),
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), {
        translate: ["P2002", "P2025", "P2034"],
        fallbackMessage: "Recurring request run failed.",
      }, { timeoutMs: REQUEST_TRANSACTION_TIMEOUT_MS });
    },
  };
}

/** The schedule that opened a request, for the requester's screen (5.3 item 4); null otherwise. */
export async function findRequestScheduleName(client: Client, requestId: string): Promise<string | null> {
  const row = await client.request.findUnique({ where: { id: requestId }, select: { recurringRequest: { select: { name: true } } } });
  return row?.recurringRequest?.name ?? null;
}
