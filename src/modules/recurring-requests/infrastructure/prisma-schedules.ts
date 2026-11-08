import type { Prisma, PrismaClient } from "@prisma/client";
import { createPrismaAuditScope } from "@/modules/audit";
import { decimalLimitText } from "@/modules/service-fields";
import { organizationToday } from "@/server/authorization/effective-permissions";
import { runSerializableTransaction } from "@/server/db/serializable-transaction";
import type { ScheduleField, ScheduleReader, ScheduleRecord, ScheduleStore, ScheduleTransaction } from "../application/schedules";
import { RECENT_RUNS } from "../application/schedules";
import type { ScheduleScope, ScheduleServiceState } from "../domain/management";

// Schedules in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 5.4). DATE columns travel as midnight
// UTC instants; the domain uses "YYYY-MM-DD". The shape is also checked by the database.

type Client = PrismaClient | Prisma.TransactionClient;

const dayOf = (value: Date) => value.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00.000Z`);

const policy = {
  translate: ["P2002", "P2025", "P2003", "P2034"] as const,
  fallbackMessage: "Recurring request schedule change failed.",
};

const serviceColumns = {
  id: true,
  name: true,
  isActive: true,
  sectorId: true,
  category: { select: { isActive: true } },
  sector: { select: { name: true, isActive: true } },
  _count: { select: { documentRequirements: { where: { isActive: true } } } },
} satisfies Prisma.ServiceSelect;

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceColumns }>;

function serviceStateOf(row: ServiceRow): ScheduleServiceState {
  return {
    id: row.id,
    name: row.name,
    sectorId: row.sectorId,
    sectorName: row.sector.name,
    isActive: row.isActive,
    categoryActive: row.category.isActive,
    sectorActive: row.sector.isActive,
    activeRequirements: row._count.documentRequirements,
  };
}

async function serviceState(client: Client, serviceId: string): Promise<ScheduleServiceState | null> {
  const row = await client.service.findUnique({ where: { id: serviceId }, select: serviceColumns });
  return row && serviceStateOf(row);
}

const fieldColumns = {
  id: true,
  label: true,
  helpText: true,
  type: true,
  isRequired: true,
  options: true,
  minValue: true,
  maxValue: true,
  decimalPlaces: true,
  minDecimal: true,
  maxDecimal: true,
  position: true,
  conditionFieldId: true,
  conditionValue: true,
} satisfies Prisma.ServiceFieldSelect;

/** The requester's active fields, as the opening reads them. */
async function activeFields(client: Client, serviceId: string): Promise<ScheduleField[]> {
  const rows = await client.serviceField.findMany({
    where: { serviceId, isActive: true, audience: "REQUESTER" },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: fieldColumns,
  });
  return rows.map((row) => ({
    ...row,
    minDecimal: decimalLimitText(row.minDecimal, row.decimalPlaces),
    maxDecimal: decimalLimitText(row.maxDecimal, row.decimalPlaces),
  }));
}

const scheduleColumns = {
  id: true,
  name: true,
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
  service: { select: { id: true, name: true, sectorId: true, sector: { select: { name: true } } } },
  requester: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  runs: {
    orderBy: { scheduledOn: "desc" },
    take: RECENT_RUNS,
    select: { scheduledOn: true, outcome: true, reason: true, requestId: true },
  },
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

function recordOf(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    name: row.name,
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
    service: { id: row.service.id, name: row.service.name, sectorId: row.service.sectorId, sectorName: row.service.sector.name },
    requester: row.requester,
    createdBy: row.createdBy,
    runs: row.runs.map((run) => ({ ...run, scheduledOn: dayOf(run.scheduledOn) })),
  };
}

const sectorFilter = (scope: ScheduleScope) => (scope.sectorId ? { sectorId: scope.sectorId } : {});

export function createPrismaScheduleReader(database: PrismaClient): ScheduleReader {
  return {
    today: () => organizationToday(database),
    async listSchedules(scope) {
      const rows = await database.recurringRequest.findMany({
        where: { service: sectorFilter(scope) },
        // Ended schedules last; then by name.
        orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { name: "asc" }, { id: "asc" }],
        select: scheduleColumns,
      });
      return rows.map(recordOf);
    },
    async serviceStates(scope) {
      const rows = await database.service.findMany({ where: sectorFilter(scope), select: serviceColumns, orderBy: [{ name: "asc" }, { id: "asc" }] });
      return rows.map(serviceStateOf);
    },
    requesters() {
      return database.user.findMany({
        where: { role: "REQUESTER", isActive: true },
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
    serviceState: (serviceId) => serviceState(database, serviceId),
    activeFields: (serviceId) => activeFields(database, serviceId),
  };
}

function transactionOf(client: Prisma.TransactionClient): ScheduleTransaction {
  return {
    ...createPrismaAuditScope(client),
    today: () => organizationToday(client),
    async now() {
      const [{ now }] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
      return now;
    },
    serviceState: (serviceId) => serviceState(client, serviceId),
    requester(userId) {
      return client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
    },
    activeFields: (serviceId) => activeFields(client, serviceId),
    countInForce(today, exceptId) {
      return client.recurringRequest.count({
        where: {
          endedAt: null,
          OR: [{ endsOn: null }, { endsOn: { gte: dateOf(today) } }],
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
      });
    },
    async findSchedule(scheduleId) {
      const row = await client.recurringRequest.findUnique({
        where: { id: scheduleId },
        select: { id: true, startsOn: true, endsOn: true, pausedAt: true, endedAt: true, service: { select: { sectorId: true } } },
      });
      return (
        row && {
          id: row.id,
          serviceSectorId: row.service.sectorId,
          startsOn: dayOf(row.startsOn),
          endsOn: row.endsOn ? dayOf(row.endsOn) : null,
          pausedAt: row.pausedAt,
          endedAt: row.endedAt,
        }
      );
    },
    create({ startsOn, endsOn, weekdays, ...input }) {
      return client.recurringRequest.create({
        data: { ...input, weekdays: [...weekdays], startsOn: dateOf(startsOn), endsOn: endsOn ? dateOf(endsOn) : null },
        select: { id: true },
      });
    },
    update(scheduleId, { startsOn, endsOn, weekdays, ...data }) {
      return client.recurringRequest.update({
        where: { id: scheduleId },
        data: {
          ...data,
          ...(weekdays !== undefined ? { weekdays: [...weekdays] } : {}),
          ...(startsOn !== undefined ? { startsOn: dateOf(startsOn) } : {}),
          ...(endsOn !== undefined ? { endsOn: endsOn ? dateOf(endsOn) : null } : {}),
        },
        select: { id: true },
      });
    },
  };
}

export function createPrismaScheduleStore(database: PrismaClient): ScheduleStore {
  return {
    run(work) {
      return runSerializableTransaction(database, (client) => work(transactionOf(client)), policy);
    },
  };
}
