import type {
  NewAssignmentEvent,
  NewPriorityEvent,
  NewStageEvent,
  NewRequestAttachment,
  NewRequestFieldValue,
  RequestQueryRepository,
  RequestTransaction,
  RequestTransactionRunner,
  ServiceForRequest,
  TransactionActor,
} from "@/modules/requests/application/ports";
import type {
  RequestRecord,
  RequestStatusEventRecord,
  RequestWithHistory,
} from "@/modules/requests/domain/request";
import type { ActiveDocumentRequirement } from "@/modules/requests/domain/attachment-requirements";
import type { DomainEvent } from "@/modules/events";
import type { AnswerableField } from "@/modules/service-fields";

export type StoredActor = TransactionActor & { name: string; email: string };
export type StoredRequirement = ActiveDocumentRequirement & { serviceId: string; isActive: boolean };
export type StoredField = AnswerableField & { serviceId: string; isActive: boolean };
export type StoredStage = { serviceId: string; name: string; position: number; isActive: boolean };
type StoredEvent = Omit<RequestStatusEventRecord, "actor">;

export interface InMemoryRequestStore {
  /** Simulated database clock returned by currentTime(). */
  databaseTime: Date;
  actors: StoredActor[];
  services: ServiceForRequest[];
  requests: RequestRecord[];
  events: StoredEvent[];
  requirements: StoredRequirement[];
  attachments: NewRequestAttachment[];
  assignmentEvents: NewAssignmentEvent[];
  outbox: DomainEvent[];
  priorityEvents: NewPriorityEvent[];
  fields: StoredField[];
  fieldValues: NewRequestFieldValue[];
  stages: StoredStage[];
  stageEvents: Array<NewStageEvent & { id: string }>;
}

export const fixedNow = new Date("2026-10-29T12:00:00.000Z");
export const serviceId = "11111111-1111-4111-8111-111111111111";
export const requestId = "22222222-2222-4222-8222-222222222222";

export function createStore(seed: Partial<InMemoryRequestStore> = {}): InMemoryRequestStore {
  return {
    databaseTime: fixedNow,
    actors: [],
    services: [],
    requests: [],
    events: [],
    requirements: [],
    attachments: [],
    assignmentEvents: [],
    outbox: [],
    priorityEvents: [],
    fields: [],
    fieldValues: [],
    stages: [],
    stageEvents: [],
    ...seed,
  };
}

export function activeService(overrides: Partial<ServiceForRequest> = {}): ServiceForRequest {
  return {
    id: serviceId,
    name: "Service",
    description: "Service description",
    isActive: true,
    defaultPriority: "NORMAL",
    slaHours: null,
    requiresApproval: false,
    category: { id: "category-1", name: "Category", isActive: true },
    sector: { id: "sector-1", name: "Sector", isActive: true },
    ...overrides,
  };
}

export function storedRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: requestId,
    requesterId: "requester-1",
    serviceId,
    sectorId: "sector-1",
    serviceNameSnapshot: "Service",
    serviceDescriptionSnapshot: "Service description",
    categoryIdSnapshot: "category-1",
    categoryNameSnapshot: "Category",
    sectorNameSnapshot: "Sector",
    description: "Need help",
    status: "OPEN",
    createdAt: fixedNow,
    updatedAt: fixedNow,
    completedAt: null,
    assigneeId: null,
    cancelledAt: null,
    priority: "NORMAL",
    slaHoursSnapshot: null,
    dueAt: null,
    completedLate: null,
    stageNamesSnapshot: [],
    stageIndex: null,
    approvalState: null,
    ...overrides,
  };
}

function lifecycleUser(store: InMemoryRequestStore, userId: string | null) {
  const user = store.actors.find(({ id }) => id === userId);
  return user ? { id: user.id, role: user.role, isActive: user.isActive, sectorId: user.sectorId } : null;
}

function nameOf(store: InMemoryRequestStore, userId: string | null) {
  const user = store.actors.find(({ id }) => id === userId);
  return user ? { id: user.id, name: user.name } : null;
}

function assigneeOf(store: InMemoryRequestStore, userId: string | null) {
  const user = store.actors.find(({ id }) => id === userId);
  return user
    ? { id: user.id, name: user.name, role: user.role, isActive: user.isActive, sectorId: user.sectorId }
    : null;
}

function withHistory(store: InMemoryRequestStore, request: RequestRecord): RequestWithHistory {
  const service = store.services.find(({ id }) => id === request.serviceId);

  return {
    ...request,
    events: store.events
      .filter(({ requestId }) => requestId === request.id)
      .map((event) => {
        const actor = store.actors.find(({ id }) => id === event.actorId);
        if (!actor) throw new Error(`Unknown actor ${event.actorId}`);
        return { ...event, actor: { id: actor.id, name: actor.name, email: actor.email } };
      }),
    service: { id: request.serviceId, isActive: service?.isActive ?? false },
    assignee: assigneeOf(store, request.assigneeId),
    priorityEvents: store.priorityEvents
      .filter(({ requestId }) => requestId === request.id)
      .map((event, index) => ({ ...event, id: `priority-${index + 1}`, actor: nameOf(store, event.actorId)! })),
    stageEvents: store.stageEvents
      .filter(({ requestId }) => requestId === request.id)
      .map((event) => ({ ...event, actor: nameOf(store, event.actorId)! })),
    assignmentEvents: store.assignmentEvents
      .filter(({ requestId }) => requestId === request.id)
      .map((event, index) => ({
        ...event,
        id: `assignment-${index + 1}`,
        actor: nameOf(store, event.actorId)!,
        fromAssignee: nameOf(store, event.fromAssigneeId),
        toAssignee: nameOf(store, event.toAssigneeId),
      })),
  };
}

export function createInMemoryQueryRepository(store: InMemoryRequestStore): RequestQueryRepository {
  const find = (predicate: (request: RequestRecord) => boolean) =>
    store.requests.filter(predicate).map((request) => withHistory(store, request));

  return {
    async listByRequester(requesterId) {
      return find((request) => request.requesterId === requesterId).reverse();
    },
    async findForRequester(requestId, requesterId) {
      return find(({ id, requesterId: owner }) => id === requestId && owner === requesterId)[0] ?? null;
    },
    async listBySector(sectorId) {
      return find((request) => request.sectorId === sectorId);
    },
    async findInSector(requestId, sectorId) {
      return find(({ id, sectorId: owner }) => id === requestId && owner === sectorId)[0] ?? null;
    },
    async search(scope, criteria) {
      // Scope and paging only; filters are covered by the PostgreSQL integration tests.
      const all = find((request) =>
        "requesterId" in scope ? request.requesterId === scope.requesterId : request.sectorId === scope.sectorId,
      );
      return { items: all.slice(0, 20), total: all.length, page: criteria.page, pageCount: 1 };
    },
    async listSectorAttendants(sectorId) {
      return store.actors
        .filter((actor) => actor.sectorId === sectorId && actor.role === "ATTENDANT" && actor.isActive)
        .map(({ id, name }) => ({ id, name }));
    },
  };
}

function createInMemoryTransaction(store: InMemoryRequestStore): RequestTransaction {
  return {
    async currentTime() {
      return store.databaseTime;
    },
    async findActor(actorId) {
      const actor = store.actors.find(({ id }) => id === actorId);
      return actor
        ? { id: actor.id, role: actor.role, sectorId: actor.sectorId, isActive: actor.isActive }
        : null;
    },
    async findServiceForRequest(serviceId) {
      return store.services.find(({ id }) => id === serviceId) ?? null;
    },
    async listActiveRequirements(serviceId) {
      return store.requirements
        .filter((requirement) => requirement.serviceId === serviceId && requirement.isActive)
        .map(({ id, name, isRequired, acceptedFormats }) => ({ id, name, isRequired, acceptedFormats }));
    },
    async listActiveFields(serviceId) {
      return store.fields
        .filter((field) => field.serviceId === serviceId && field.isActive)
        .sort((left, right) => left.position - right.position)
        .map(({ id, label, type, isRequired, options, minValue, maxValue, position }) => ({
          id,
          label,
          type,
          isRequired,
          options,
          minValue,
          maxValue,
          position,
        }));
    },
    async insertRequest({ openedAt, id, ...data }) {
      store.requests.push({
        completedLate: null,
        stageNamesSnapshot: [],
        stageIndex: null,
        ...data,
        id,
        createdAt: openedAt,
        updatedAt: openedAt,
        completedAt: null,
        assigneeId: null,
        cancelledAt: null,
      });
      return { id };
    },
    async updateStatusIfCurrent(update) {
      const request = store.requests.find(
        ({ id, sectorId, status, assigneeId }) =>
          id === update.requestId &&
          sectorId === update.sectorId &&
          status === update.expectedStatus &&
          (update.expectedAssigneeId === undefined || assigneeId === update.expectedAssigneeId),
      );
      if (!request) return 0;
      if (update.expectedStageIndex !== undefined && request.stageIndex !== update.expectedStageIndex) return 0;
      request.status = update.toStatus;
      request.updatedAt = update.updatedAt;
      if (update.completedAt !== undefined) request.completedAt = update.completedAt;
      if (update.cancelledAt) request.cancelledAt = update.cancelledAt;
      if (update.completedLate !== undefined) request.completedLate = update.completedLate;
      if (update.dueAt !== undefined) request.dueAt = update.dueAt;
      if (update.stageNamesSnapshot !== undefined) request.stageNamesSnapshot = update.stageNamesSnapshot;
      if (update.stageIndex !== undefined) request.stageIndex = update.stageIndex;
      return 1;
    },
    async listActiveStageNames(serviceId) {
      return store.stages
        .filter((stage) => stage.serviceId === serviceId && stage.isActive)
        .sort((left, right) => left.position - right.position)
        .map(({ name }) => name);
    },
    async updateStageIfCurrent(update) {
      const request = store.requests.find(
        ({ id, status, assigneeId, stageIndex }) =>
          id === update.requestId &&
          status === "IN_PROGRESS" &&
          assigneeId === update.expectedAssigneeId &&
          stageIndex === update.expectedStageIndex,
      );
      if (!request) return 0;
      request.stageIndex = update.stageIndex;
      request.updatedAt = update.updatedAt;
      return 1;
    },
    async insertStageEvent(event) {
      const id = `stage-event-${store.stageEvents.length + 1}`;
      store.stageEvents.push({ ...event, id });
      return id;
    },
    async insertAttachments(attachments) {
      store.attachments.push(...attachments);
    },
    async insertFieldValues(values) {
      store.fieldValues.push(...values);
    },
    async insertStatusEvent(event) {
      store.events.push({
        id: `event-${store.events.length + 1}`,
        requestId: event.requestId,
        actorId: event.actorId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        occurredAt: event.occurredAt,
        note: event.note ?? null,
      });
    },
    async findLifecycleState(requestId) {
      const request = store.requests.find(({ id }) => id === requestId);
      return request
        ? {
            requesterId: request.requesterId,
            sectorId: request.sectorId,
            status: request.status,
            completedAt: request.completedAt,
            priority: request.priority,
            slaHoursSnapshot: request.slaHoursSnapshot,
            dueAt: request.dueAt,
            serviceId: request.serviceId,
            stageNamesSnapshot: request.stageNamesSnapshot,
            stageIndex: request.stageIndex,
            approvalState: request.approvalState,
            assignee: lifecycleUser(store, request.assigneeId),
          }
        : null;
    },
    async findUserForAssignment(userId) {
      return lifecycleUser(store, userId);
    },
    async updateAssigneeIfCurrent(update) {
      const request = store.requests.find(
        ({ id, status, assigneeId }) =>
          id === update.requestId &&
          status === update.expectedStatus &&
          assigneeId === update.expectedAssigneeId,
      );
      if (!request) return 0;
      request.assigneeId = update.assigneeId;
      request.updatedAt = update.updatedAt;
      return 1;
    },
    async insertAssignmentEvent(event) {
      store.assignmentEvents.push({ ...event });
    },
    async recordEvent(event) {
      store.outbox.push(event);
    },
    async updatePriorityIfCurrent(update) {
      const request = store.requests.find(
        ({ id, status, assigneeId, priority }) =>
          id === update.requestId &&
          status === update.expectedStatus &&
          assigneeId === update.expectedAssigneeId &&
          priority === update.expectedPriority,
      );
      if (!request) return 0;
      request.priority = update.priority;
      request.dueAt = update.dueAt;
      request.updatedAt = update.updatedAt;
      return 1;
    },
    async insertPriorityEvent(event) {
      store.priorityEvents.push({ ...event });
    },
    async getWithHistory(requestId) {
      const request = store.requests.find(({ id }) => id === requestId);
      if (!request) throw new Error(`Unknown request ${requestId}`);
      return withHistory(store, request);
    },
  };
}

/** Runs work against the store and restores the previous state when it throws. */
export function createInMemoryTransactionRunner(store: InMemoryRequestStore): RequestTransactionRunner {
  return {
    async run(work) {
      const before = structuredClone(store);
      try {
        return await work(createInMemoryTransaction(store));
      } catch (error) {
        Object.assign(store, before);
        throw error;
      }
    },
  };
}
