import type { DetectedDocumentFormat } from "@/modules/attachments";
import type { DomainEvent } from "@/modules/events";
import type { AnswerableField, FieldAnswer } from "@/modules/service-fields";
import type { RequestAttachmentSummary, StoredRequestAttachment } from "../domain/attachment";
import type { ActiveDocumentRequirement } from "../domain/attachment-requirements";
import type { RequestFieldAnswer } from "../domain/field-answer";
import type { ApprovalState } from "../domain/approval";
import type { LifecycleRequest, LifecycleUser } from "../domain/lifecycle";
import type { SearchCriteria } from "../domain/search-criteria";
import type { RequestPriority, RequestStatus, RequestWithHistory } from "../domain/request";
import type { RequestSnapshot } from "../domain/snapshot";

export type ActorRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface RequestQueryRepository {
  listByRequester(requesterId: string): Promise<RequestWithHistory[]>;
  findForRequester(requestId: string, requesterId: string): Promise<RequestWithHistory | null>;
  listBySector(sectorId: string): Promise<RequestWithHistory[]>;
  findInSector(requestId: string, sectorId: string): Promise<RequestWithHistory | null>;
  /** Active attendants of a sector, by name, for the transfer form. */
  listSectorAttendants(sectorId: string): Promise<Array<{ id: string; name: string }>>;
  /**
   * One page of the reader's list (SPEC 2026-10-31-busca-filtros-paginacao). `scope` is
   * built from the session; `viewerId` resolves the "mine" assignee filter.
   */
  search(scope: RequestSearchScope, criteria: SearchCriteria, viewerId: string): Promise<RequestSearchPage>;
}

export type RequestSearchScope = { requesterId: string } | { sectorId: string };

export interface RequestSearchPage {
  items: RequestWithHistory[];
  total: number;
  page: number;
  pageCount: number;
}

export interface TransactionActor {
  id: string;
  role: ActorRole;
  sectorId: string | null;
  isActive: boolean;
}

export interface ServiceForRequest {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  /** SPEC 2026-11-01 (SLA): applied to the request on opening. */
  defaultPriority: RequestPriority;
  slaHours: number | null;
  /** SPEC 2026-11-01 (aprovações): copied to the request on opening. */
  requiresApproval: boolean;
  category: { id: string; name: string; isActive: boolean };
  sector: { id: string; name: string; isActive: boolean };
}

export interface NewStatusEvent {
  requestId: string;
  actorId: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  occurredAt: Date;
  /** Cancellation or reopening reason (SPEC 2026-10-31, section 5.9). */
  note?: string | null;
}

export interface StatusUpdate {
  requestId: string;
  sectorId: string;
  expectedStatus: RequestStatus;
  /** When given, the assignee must also be unchanged since the read (section 5.8). */
  expectedAssigneeId?: string | null;
  toStatus: RequestStatus;
  updatedAt: Date;
  /** Set on completion; null clears it on reopening (section 5.5). Omitted keeps it. */
  completedAt?: Date | null;
  /** Set on cancellation (section 5.4). */
  cancelledAt?: Date;
  /** SLA result on completion; null clears it (SPEC 2026-11-01, section 5.3). */
  completedLate?: boolean | null;
  /** New due date, on reopening. */
  dueAt?: Date | null;
  /** Clears the alert marks so a new due date can be alerted again (section 5.5). */
  resetSlaAlerts?: boolean;
  /** When given, the stage must also be unchanged since the read (SPEC de fluxos, 5.3.5). */
  expectedStageIndex?: number | null;
  /** Flow copy set on start and cleared on reopening (SPEC de fluxos, 5.2 and 5.4). */
  stageNamesSnapshot?: string[];
  stageIndex?: number | null;
}

/** Moves the stage only while status, assignee and stage are still the ones read. */
export interface StageUpdate {
  requestId: string;
  expectedAssigneeId: string | null;
  expectedStageIndex: number;
  stageIndex: number;
  updatedAt: Date;
}

export interface NewStageEvent {
  requestId: string;
  actorId: string;
  fromStage: string | null;
  toStage: string;
  note: string | null;
  occurredAt: Date;
}

/** Changes the assignee only while status and assignee still equal the values read. */
export interface AssigneeUpdate {
  requestId: string;
  expectedStatus: RequestStatus;
  expectedAssigneeId: string | null;
  assigneeId: string | null;
  updatedAt: Date;
}

export interface NewAssignmentEvent {
  requestId: string;
  actorId: string;
  fromAssigneeId: string | null;
  toAssigneeId: string | null;
  occurredAt: Date;
}

/** Changes the priority only while status, assignee and priority are still the ones read. */
export interface PriorityUpdate {
  requestId: string;
  expectedStatus: RequestStatus;
  expectedAssigneeId: string | null;
  expectedPriority: RequestPriority;
  priority: RequestPriority;
  dueAt: Date | null;
  resetSlaAlerts: boolean;
  updatedAt: Date;
}

export interface NewPriorityEvent {
  requestId: string;
  actorId: string;
  fromPriority: RequestPriority;
  toPriority: RequestPriority;
  occurredAt: Date;
}

/** Attachment row; every field is derived on the server (SPEC 21.4 item 8, 21.9). */
export interface NewRequestAttachment {
  id: string;
  requestId: string;
  requirementId: string;
  requirementNameSnapshot: string;
  requirementRequiredSnapshot: boolean;
  originalFilename: string;
  detectedFormat: DetectedDocumentFormat;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  uploadedById: string;
  createdAt: Date;
}

/** Private object storage for attachment content (SPEC 21.8). */
/** Answer to a custom field, with the snapshot of its definition (SPEC de campos, 5.4). */
export interface NewRequestFieldValue extends FieldAnswer {
  requestId: string;
  createdAt: Date;
}

export interface AttachmentStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Reads the content of attachments that are referenced by a database row. */
export interface AttachmentContentReader {
  get(key: string): Promise<Uint8Array>;
}

export interface FieldAnswerQueryRepository {
  findRequestScope(requestId: string): Promise<{ requesterId: string; sectorId: string } | null>;
  /** Answers of the request in snapshot order. */
  listForRequest(requestId: string): Promise<RequestFieldAnswer[]>;
}

export interface AttachmentQueryRepository {
  findRequestScope(requestId: string): Promise<{ requesterId: string; sectorId: string } | null>;
  listForRequest(requestId: string): Promise<RequestAttachmentSummary[]>;
  /** Filters by both identifiers, so an attachment of another request is not found. */
  findInRequest(requestId: string, attachmentId: string): Promise<StoredRequestAttachment | null>;
}

/** Operations available inside a request transaction. */
export interface RequestTransaction {
  /**
   * Database time of the current transaction. Every request and status event time comes
   * from this single clock (SPEC 2026-09-30, section 23).
   */
  currentTime(): Promise<Date>;
  findActor(actorId: string): Promise<TransactionActor | null>;
  findServiceForRequest(serviceId: string): Promise<ServiceForRequest | null>;
  /** Active document requirements of the service, in display order. */
  listActiveRequirements(serviceId: string): Promise<ActiveDocumentRequirement[]>;
  /** Names of the active stages of the service, in flow order (SPEC de fluxos, 5.2). */
  listActiveStageNames(serviceId: string): Promise<string[]>;
  /** Returns the number of rows changed (0 when the request changed meanwhile). */
  updateStageIfCurrent(update: StageUpdate): Promise<number>;
  /** Returns the id of the history row. */
  insertStageEvent(event: NewStageEvent): Promise<string>;
  /** Active custom fields of the service, in display order. */
  listActiveFields(serviceId: string): Promise<AnswerableField[]>;
  insertRequest(
    data: RequestSnapshot & {
      id: string;
      description: string;
      status: RequestStatus;
      openedAt: Date;
      priority: RequestPriority;
      slaHoursSnapshot: number | null;
      dueAt: Date | null;
      approvalState: ApprovalState | null;
    },
  ): Promise<{ id: string }>;
  insertAttachments(attachments: NewRequestAttachment[]): Promise<void>;
  insertFieldValues(values: NewRequestFieldValue[]): Promise<void>;
  /** Updates the status only while it still equals `expectedStatus`; returns the number of rows changed. */
  updateStatusIfCurrent(update: StatusUpdate): Promise<number>;
  insertStatusEvent(event: NewStatusEvent): Promise<void>;
  /** State needed by the lifecycle rules, with the current assignee as stored now. */
  findLifecycleState(requestId: string): Promise<LifecycleRequest | null>;
  findUserForAssignment(userId: string): Promise<LifecycleUser | null>;
  /** Returns the number of rows changed (0 when status or assignee changed meanwhile). */
  updateAssigneeIfCurrent(update: AssigneeUpdate): Promise<number>;
  insertAssignmentEvent(event: NewAssignmentEvent): Promise<void>;
  /** Returns the number of rows changed (0 when the request changed meanwhile). */
  updatePriorityIfCurrent(update: PriorityUpdate): Promise<number>;
  insertPriorityEvent(event: NewPriorityEvent): Promise<void>;
  /** Writes a domain event to the outbox in this same transaction (SPEC de eventos, 6.2). */
  recordEvent(event: DomainEvent): Promise<void>;
  getWithHistory(requestId: string): Promise<RequestWithHistory>;
}

/** Runs work atomically with serializable isolation. */
export interface RequestTransactionRunner {
  run<T>(work: (transaction: RequestTransaction) => Promise<T>): Promise<T>;
}
