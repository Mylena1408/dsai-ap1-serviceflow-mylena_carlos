import type {
  NewAssignmentEvent,
  NewRequestAttachment,
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

export type StoredActor = TransactionActor & { name: string; email: string };
export type StoredRequirement = ActiveDocumentRequirement & { serviceId: string; isActive: boolean };
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
    ...seed,
  };
}

export function activeService(overrides: Partial<ServiceForRequest> = {}): ServiceForRequest {
  return {
    id: serviceId,
    name: "Service",
    description: "Service description",
    isActive: true,
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
    async insertRequest({ openedAt, id, ...data }) {
      store.requests.push({
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
      request.status = update.toStatus;
      request.updatedAt = update.updatedAt;
      if (update.completedAt !== undefined) request.completedAt = update.completedAt;
      if (update.cancelledAt) request.cancelledAt = update.cancelledAt;
      return 1;
    },
    async insertAttachments(attachments) {
      store.attachments.push(...attachments);
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
