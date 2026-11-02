import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  DEMO_ACCOUNTS,
  DEMO_SECTOR_NAME,
  LEGACY_DEMO_EMAILS,
  ensureDemoSector,
  hashPassword,
  type DemoRole,
} from "@/modules/auth";
import { buildRequestSnapshot, completedLateAt, dueAtFrom } from "@/modules/requests";
import { prisma } from "@/server/db";
import {
  DEMO_CATALOG,
  DEMO_DOCUMENT_REQUIREMENTS,
  DEMO_EXTRA_REQUESTERS,
  DEMO_NOTIFICATIONS,
  DEMO_REQUESTS,
  DEMO_SERVICE_FIELDS,
  DEMO_SERVICE_SETTINGS,
  demoTimeline,
  hoursAfterOpening,
  type DemoRequestScenario,
  type DemoServiceName,
} from "../domain/demo-data";

// Loader of the fictitious data (SPEC 2026-09-30, sections 22.6, 22.7 and 25). Used by
// `npm run seed:demo` and, through `ensureDemoDataLoaded`, by the first demonstration click.

type PersonKey = "marina" | "ana" | "bruno" | "carla" | "diego" | "paulo";

const PEOPLE: Record<PersonKey, { name: string; email: string; role: DemoRole }> = {
  marina: { ...DEMO_ACCOUNTS.ADMIN, role: "ADMIN" },
  ana: { ...DEMO_ACCOUNTS.REQUESTER, role: "REQUESTER" },
  bruno: { ...DEMO_EXTRA_REQUESTERS.bruno, role: "REQUESTER" },
  carla: { ...DEMO_EXTRA_REQUESTERS.carla, role: "REQUESTER" },
  diego: { ...DEMO_ACCOUNTS.ATTENDANT, role: "ATTENDANT" },
  paulo: { ...DEMO_ACCOUNTS.MANAGER, role: "MANAGER" },
};

const REQUESTER_EMAILS = [PEOPLE.ana.email, PEOPLE.bruno.email, PEOPLE.carla.email];
const HOUR_MS = 60 * 60 * 1000;

export interface DemoDataSummary {
  categories: number;
  services: number;
  users: number;
  requestsCreated: number;
  requirementsCreated: number;
}

interface SavedService {
  id: string;
  name: string;
  description: string;
  category: { id: string; name: string };
  slaHours: number | null;
  defaultPriority: Prisma.ServiceGetPayload<object>["defaultPriority"];
}

type Transaction = Prisma.TransactionClient;

/** An Argon2id hash of a discarded random value: nobody can sign in with a password (25.1). */
function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64"));
}

async function ensureCategory(transaction: Transaction, name: string): Promise<string> {
  const existing = await transaction.category.findFirst({
    where: { name },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, isActive: true },
  });

  if (!existing) {
    return (await transaction.category.create({ data: { name }, select: { id: true } })).id;
  }
  if (!existing.isActive) {
    await transaction.category.update({ where: { id: existing.id }, data: { isActive: true } });
  }
  return existing.id;
}

async function saveCatalog(transaction: Transaction, sectorId: string): Promise<Map<DemoServiceName, SavedService>> {
  const services = new Map<DemoServiceName, SavedService>();
  const select = { id: true, slaHours: true, defaultPriority: true } as const;

  for (const group of DEMO_CATALOG) {
    const categoryId = await ensureCategory(transaction, group.category);

    for (const service of group.services) {
      const settings = DEMO_SERVICE_SETTINGS[service.name] ?? {};
      const existing = await transaction.service.findFirst({
        where: { name: service.name, categoryId },
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const saved = existing
        ? await transaction.service.update({
            where: { id: existing.id },
            data: { description: service.description, sectorId, isActive: true, ...settings },
            select,
          })
        : await transaction.service.create({ data: { ...service, categoryId, sectorId, ...settings }, select });

      services.set(service.name, {
        ...saved,
        name: service.name,
        description: service.description,
        category: { id: categoryId, name: group.category },
      });
    }
  }

  return services;
}

async function savePeople(
  transaction: Transaction,
  sectorId: string,
  newHashes: ReadonlyMap<string, string>,
): Promise<Record<PersonKey, string>> {
  const ids = {} as Record<PersonKey, string>;

  for (const [key, person] of Object.entries(PEOPLE) as Array<[PersonKey, (typeof PEOPLE)[PersonKey]]>) {
    const data = {
      name: person.name,
      role: person.role,
      sectorId: person.role === "ATTENDANT" || person.role === "MANAGER" ? sectorId : null,
      isActive: true,
    };
    const current = await transaction.user.findUnique({ where: { email: person.email }, select: { id: true } });
    const saved = current
      ? await transaction.user.update({ where: { id: current.id }, data, select: { id: true } })
      : await transaction.user.create({
          data: { ...data, email: person.email, passwordHash: newHashes.get(person.email) ?? (await unusablePasswordHash()) },
          select: { id: true },
        });
    ids[key] = saved.id;
  }

  // Section 25.1: the generic accounts of the previous demonstration mode stop being usable.
  await transaction.user.updateMany({ where: { email: { in: [...LEGACY_DEMO_EMAILS] }, isActive: true }, data: { isActive: false } });

  return ids;
}

async function saveRequirements(transaction: Transaction, services: Map<DemoServiceName, SavedService>): Promise<number> {
  let created = 0;

  for (const { service: serviceName, requirements } of DEMO_DOCUMENT_REQUIREMENTS) {
    const service = services.get(serviceName)!;
    // A service already configured (even by hand) is left alone.
    if ((await transaction.serviceDocumentRequirement.count({ where: { serviceId: service.id } })) > 0) continue;

    await transaction.serviceDocumentRequirement.createMany({
      data: requirements.map((requirement, position) => ({
        serviceId: service.id,
        name: requirement.name,
        isRequired: requirement.isRequired,
        acceptedFormats: [...requirement.acceptedFormats],
        position,
      })),
    });
    created += requirements.length;
  }

  return created;
}

async function saveFields(transaction: Transaction, services: Map<DemoServiceName, SavedService>): Promise<void> {
  for (const { service: serviceName, fields } of DEMO_SERVICE_FIELDS) {
    const service = services.get(serviceName)!;
    if ((await transaction.serviceField.count({ where: { serviceId: service.id } })) > 0) continue;

    await transaction.serviceField.createMany({
      data: fields.map((field, position) => ({
        serviceId: service.id,
        label: field.label,
        helpText: field.helpText ?? null,
        type: field.type,
        isRequired: field.isRequired,
        options: [...(field.options ?? [])],
        minValue: field.minValue ?? null,
        maxValue: field.maxValue ?? null,
        position,
      })),
    });
  }
}

/** Writes one scenario as the real use cases would have: request, history, approval, conversation and answers. */
async function saveRequest(
  transaction: Transaction,
  scenario: DemoRequestScenario,
  context: { now: Date; people: Record<PersonKey, string>; service: SavedService; sector: { id: string; name: string } },
): Promise<string> {
  const { people, service, sector } = context;
  const timeline = demoTimeline(scenario, context.now);
  const requesterId = people[scenario.requester];
  const attendantId = people.diego;
  const managerId = people.paulo;
  const decision = scenario.approval?.decision ?? null;
  const waitsOrRejected = decision === "PENDING" || decision === "REJECTED";
  const dueAt = waitsOrRejected
    ? null
    : dueAtFrom(timeline.decidedAt ?? timeline.openedAt, service.slaHours, service.defaultPriority);

  const request = await transaction.request.create({
    data: {
      ...buildRequestSnapshot(requesterId, { ...service, sector }),
      description: scenario.description,
      status: scenario.outcome,
      priority: service.defaultPriority,
      slaHoursSnapshot: service.slaHours,
      dueAt,
      completedLate: timeline.completedAt ? completedLateAt(dueAt, timeline.completedAt) : null,
      approvalState: decision,
      assigneeId: timeline.startedAt ? attendantId : null,
      createdAt: timeline.openedAt,
      updatedAt: timeline.updatedAt,
      completedAt: timeline.completedAt,
      cancelledAt: timeline.cancelledAt,
    },
    select: { id: true },
  });
  const requestId = request.id;

  const events: Prisma.RequestStatusEventCreateManyInput[] = [
    { requestId, actorId: requesterId, fromStatus: null, toStatus: "OPEN", occurredAt: timeline.openedAt },
  ];
  if (timeline.cancelledAt) {
    events.push({
      requestId,
      actorId: decision === "REJECTED" ? managerId : requesterId,
      fromStatus: "OPEN",
      toStatus: "CANCELLED",
      occurredAt: timeline.cancelledAt,
      note: scenario.approval && scenario.approval.decision !== "PENDING" ? scenario.approval.note : scenario.cancel!.note,
    });
  }
  if (timeline.startedAt) {
    events.push({ requestId, actorId: attendantId, fromStatus: "OPEN", toStatus: "IN_PROGRESS", occurredAt: timeline.startedAt });
  }
  if (timeline.completedAt) {
    events.push({ requestId, actorId: attendantId, fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", occurredAt: timeline.completedAt });
  }
  await transaction.requestStatusEvent.createMany({ data: events });

  if (timeline.assignedAt) {
    await transaction.requestAssignmentEvent.create({
      data: { requestId, actorId: attendantId, fromAssigneeId: null, toAssigneeId: attendantId, occurredAt: timeline.assignedAt },
    });
  }

  if (scenario.approval && scenario.approval.decision !== "PENDING" && timeline.decidedAt) {
    await transaction.requestApproval.create({
      data: {
        requestId,
        deciderId: managerId,
        decision: scenario.approval.decision,
        note: scenario.approval.note,
        decidedAt: timeline.decidedAt,
      },
    });
  }

  if (scenario.comments?.length) {
    await transaction.requestComment.createMany({
      data: scenario.comments.map((comment) => ({
        requestId,
        authorId: comment.author === "requester" ? requesterId : attendantId,
        body: comment.body,
        isInternal: comment.internal ?? false,
        createdAt: hoursAfterOpening(timeline.openedAt, comment.afterHours),
      })),
    });
  }

  if (scenario.fieldAnswers) {
    const fields = await transaction.serviceField.findMany({
      where: { serviceId: service.id, isActive: true, label: { in: Object.keys(scenario.fieldAnswers) } },
      select: { id: true, label: true, type: true, position: true },
    });
    await transaction.requestFieldValue.createMany({
      data: fields.map((field) => ({
        requestId,
        fieldId: field.id,
        labelSnapshot: field.label,
        typeSnapshot: field.type,
        positionSnapshot: field.position,
        value: scenario.fieldAnswers![field.label]!,
        createdAt: timeline.openedAt,
      })),
    });
  }

  return requestId;
}

async function saveRequests(
  transaction: Transaction,
  context: { now: Date; people: Record<PersonKey, string>; services: Map<DemoServiceName, SavedService>; sector: { id: string; name: string } },
): Promise<number> {
  const requests = new Map<string, { id: string; openedAt: Date }>();

  for (const scenario of DEMO_REQUESTS) {
    const id = await saveRequest(transaction, scenario, { ...context, service: context.services.get(scenario.service)! });
    requests.set(scenario.key, { id, openedAt: demoTimeline(scenario, context.now).openedAt });
  }

  await transaction.requestNotification.createMany({
    data: DEMO_NOTIFICATIONS.map((notification) => {
      const request = requests.get(notification.request)!;
      const createdAt = hoursAfterOpening(request.openedAt, notification.afterHours);
      return {
        recipientId: context.people[notification.recipient],
        requestId: request.id,
        type: notification.type,
        createdAt,
        readAt: notification.read ? new Date(createdAt.getTime() + HOUR_MS) : null,
      };
    }),
  });

  return DEMO_REQUESTS.length;
}

/**
 * Creates or restores the fictitious data without duplicating records: catalog, people,
 * requirements and fields are restored on every run; requests only on the first one.
 */
export async function loadDemoData(database: PrismaClient = prisma, now: Date = new Date()): Promise<DemoDataSummary> {
  // Argon2 is slow on purpose, so hashes for missing people are computed outside the transaction.
  const existing = new Set(
    (
      await database.user.findMany({
        where: { email: { in: Object.values(PEOPLE).map(({ email }) => email) } },
        select: { email: true },
      })
    ).map(({ email }) => email.toLowerCase()),
  );
  const newHashes = new Map<string, string>();
  for (const { email } of Object.values(PEOPLE)) {
    if (!existing.has(email.toLowerCase())) newHashes.set(email, await unusablePasswordHash());
  }

  return database.$transaction(
    async (transaction) => {
      const sector = { id: await ensureDemoSector(transaction), name: DEMO_SECTOR_NAME };
      const services = await saveCatalog(transaction, sector.id);
      const people = await savePeople(transaction, sector.id, newHashes);
      const requirementsCreated = await saveRequirements(transaction, services);
      await saveFields(transaction, services);

      // The fictitious requesters' history marks a previous run (section 25.2).
      const previous = await transaction.request.count({
        where: { requesterId: { in: [people.ana, people.bruno, people.carla] } },
      });
      const requestsCreated = previous === 0 ? await saveRequests(transaction, { now, people, services, sector }) : 0;

      return {
        categories: DEMO_CATALOG.length,
        services: services.size,
        users: Object.keys(people).length,
        requestsCreated,
        requirementsCreated,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
  );
}

/**
 * Section 25.2: loads the fictitious data only when it is not there yet, so later clicks do not
 * undo changes made in the administration. Returns null when nothing was loaded.
 */
export async function ensureDemoDataLoaded(
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<DemoDataSummary | null> {
  const requesters = await database.user.findMany({ where: { email: { in: REQUESTER_EMAILS } }, select: { id: true } });

  if (requesters.length > 0) {
    const loaded = await database.request.count({ where: { requesterId: { in: requesters.map(({ id }) => id) } } });
    if (loaded > 0) return null;
  }

  return loadDemoData(database, now);
}
