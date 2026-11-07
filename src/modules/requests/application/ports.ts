import type { SlaResumeCause } from "../domain/sla-pause";
import type { OpeningAnswer, StageSettings } from "../domain/stages";
import type { BusinessCalendar } from "@/shared/business-clock";
import type { DetectedDocumentFormat } from "@/modules/attachments";
import type { DomainEvent } from "@/modules/events";
import type { Permission } from "@/shared/permissions";
import type { AnswerableField, FieldAnswer } from "@/modules/service-fields";
import type { RequestAttachmentSummary, StoredRequestAttachment } from "../domain/attachment";
import type { ActiveDocumentRequirement } from "../domain/attachment-requirements";
import type { RequestFieldAnswer } from "../domain/field-answer";
import type { ApprovalState } from "../domain/approval";
import type { LifecycleRequest, LifecycleUser, SectorDestination } from "../domain/lifecycle";
import type { SearchCriteria } from "../domain/search-criteria";
import type { RequestPriority, RequestStatus, RequestWithHistory } from "../domain/request";
import type { RequestSnapshot } from "../domain/snapshot";

export type ActorRole = "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";

export interface RequestQueryRepository {
  listByRequester(requesterId: string): Promise<RequestWithHistory[]>;
  findForRequester(requestId: string, requesterId: string): Promise<RequestWithHistory | null>;
  listBySector(sectorId: string): Promise<RequestWithHistory[]>;
  findInSector(requestId: string, sectorId: string): Promise<RequestWithHistory | null>;
  /**
   * Requests that require approval of the given sectors, pending first (SPEC de aprovações, 5.7):
   * the manager's own, and the sectors replaced in an absence (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 4.3.5). Older doubles may read only the first one.
   */
  listForApproval(sectorId: string, onlyPending: boolean, coveredSectorIds?: readonly string[]): Promise<RequestWithHistory[]>;
  /** A request that requires approval of one of these sectors, or null. */
  findForApproval(requestId: string, sectorId: string, coveredSectorIds?: readonly string[]): Promise<RequestWithHistory | null>;
  /** 4.3.5: sectors this manager replaces today. Optional for older doubles: absent = none. */
  approvalCoverage?(managerId: string): Promise<Array<{ sectorId: string; managerId: string }>>;
  /** Names of sectors by id (the approval levels, 4.3.3). Optional for older doubles: absent = none. */
  sectorNames?(sectorIds: readonly string[]): Promise<Map<string, string>>;
  /** Active attendants of a sector, by name, for the transfer form. */
  listSectorAttendants(sectorId: string): Promise<Array<{ id: string; name: string }>>;
  /**
   * Sectors that may receive a request of `currentSectorId` (SPEC 2026-11-03-transferencia-entre-
   * setores, 5.2): active, different and with an active attendant, by name.
   */
  listSectorDestinations(currentSectorId: string): Promise<Array<{ id: string; name: string }>>;
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
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.1 and 4.3.7: level sectors (empty = the
   * service's sector) and the condition on a requester answer. Optional for older doubles.
   */
  approvalSectorIds?: string[];
  approvalConditionFieldId?: string | null;
  approvalConditionValue?: string | null;
  /** 4.3.6: days to decide each level, copied at the opening. */
  approvalDeadlineDays?: number | null;
  /** SPEC 2026-11-03-pausa-sla-calendario, 5.2: copied to the request on opening. */
  slaBusinessHours?: boolean;
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
  /** Start of "due soon", written only in business hours (SPEC 2026-11-03-pausa-sla-calendario, 6). */
  dueSoonAt?: Date | null;
  /** Clears the alert marks so a new due date can be alerted again (section 5.5). */
  resetSlaAlerts?: boolean;
  /**
   * SPEC 2026-11-03-pausa-sla-calendario, 5.4.3: the end of the attendance ends a running pause.
   * When given, the pause start must also be unchanged since the read.
   */
  expectedSlaPausedAt?: Date | null;
  slaPausedAt?: null;
  /** When given, the stage must also be unchanged since the read (SPEC de fluxos, 5.3.5). */
  expectedStageIndex?: number | null;
  /** Flow copy set on start and cleared on reopening (SPEC de fluxos, 5.2 and 5.4). */
  stageNamesSnapshot?: string[];
  stageIndex?: number | null;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 5.4: per stage details and the stage due date. */
  stageAssigneeIdsSnapshot?: string[];
  stageTargetDaysSnapshot?: number[];
  stageDueAt?: Date | null;
  stageOverdueNotifiedAt?: null;
}

/**
 * Decides the approval only while the request is still open, pending and at the level read (SPEC
 * de aprovações, 5.4; SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3). Approving a level
 * that is not the last keeps it pending and moves to the next level and its sector.
 */
export interface ApprovalUpdate {
  requestId: string;
  approvalState: "PENDING" | "APPROVED" | "REJECTED";
  updatedAt: Date;
  /** The level read (null for requests opened before levels). */
  expectedLevel?: number | null;
  /** Next level and its sector, written only when approving a level that is not the last. */
  approvalLevel?: number;
  approvalPendingSectorId?: string | null;
  /** 4.3.6: due date of the next level (null at the end), and the delay announcement cleared. */
  approvalDueAt?: Date | null;
  approvalOverdueNotifiedAt?: null;
  /** Due date from the approval (5.5). */
  dueAt?: Date | null;
  /** Start of "due soon", written only in business hours (SPEC 2026-11-03-pausa-sla-calendario, 6). */
  dueSoonAt?: Date | null;
  /** The rejection cancels the request (5.3.4). */
  status?: "CANCELLED";
  cancelledAt?: Date;
}

export interface NewApproval {
  requestId: string;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3; 1 when absent. */
  level?: number;
  /** 4.3.5: the absent manager the decider replaced. */
  onBehalfOfId?: string;
  /** 4.3.6: the due date the level had. */
  dueAt?: Date;
  deciderId: string;
  decision: "APPROVED" | "REJECTED";
  note: string | null;
  decidedAt: Date;
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

/**
 * Moves the request to another sector (SPEC 2026-11-03-transferencia-entre-setores, 5.3) only while
 * it is still open, in the sector read, with the assignee read and without a pending approval.
 * The assignee is removed.
 */
export interface SectorUpdate {
  requestId: string;
  expectedSectorId: string;
  expectedAssigneeId: string | null;
  sectorId: string;
  sectorName: string;
  updatedAt: Date;
}

export interface NewSectorEvent {
  requestId: string;
  actorId: string;
  fromSectorId: string;
  toSectorId: string;
  fromSectorName: string;
  toSectorName: string;
  note: string;
  occurredAt: Date;
}

/**
 * Starts or ends a pause (SPEC 2026-11-03-pausa-sla-calendario, 5.3 and 5.4) only while the request
 * is in progress with the assignee and the pause start read.
 */
export interface SlaPauseUpdate {
  requestId: string;
  expectedAssigneeId: string | null;
  expectedSlaPausedAt: Date | null;
  slaPausedAt: Date | null;
  /** New schedule on resume. */
  dueAt?: Date | null;
  dueSoonAt?: Date | null;
  updatedAt: Date;
}

export interface NewSlaPause {
  requestId: string;
  pausedById: string;
  reason: string;
  pausedAt: Date;
}

export interface SlaPauseClosing {
  requestId: string;
  resumedAt: Date;
  resumedById: string;
  resumeCause: SlaResumeCause;
}

/** SPEC 2026-11-03-campos-condicionais-atendimento, 5.5.2 and 5.5.5. */
export interface AttendanceAnswersChange {
  requestId: string;
  actorId: string;
  at: Date;
  upserts: FieldAnswer[];
  removals: string[];
}

/** History line of a save of the attendance fields: labels only (5.5.3). */
export interface NewFieldUpdateEvent {
  requestId: string;
  actorId: string;
  labels: string[];
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
  /** Start of "due soon", written only in business hours (SPEC 2026-11-03-pausa-sla-calendario, 6). */
  dueSoonAt?: Date | null;
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
  findRequestScope(
    requestId: string,
  ): Promise<{ requesterId: string; sectorId: string; requiresApproval?: boolean; approvalSectorIds?: string[] } | null>;
  /**
   * Sectors an absent manager left to this substitute today (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 4.3.5). Optional for older doubles: absent = none.
   */
  approvalCoverage?(managerId: string): Promise<Array<{ sectorId: string; managerId: string }>>;
  /** Answers of the request in snapshot order. */
  listForRequest(requestId: string): Promise<RequestFieldAnswer[]>;
}

export interface AttachmentQueryRepository {
  findRequestScope(
    requestId: string,
  ): Promise<{ requesterId: string; sectorId: string; requiresApproval?: boolean; approvalSectorIds?: string[] } | null>;
  /**
   * Sectors an absent manager left to this substitute today (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 4.3.5). Optional for older doubles: absent = none.
   */
  approvalCoverage?(managerId: string): Promise<Array<{ sectorId: string; managerId: string }>>;
  listForRequest(requestId: string): Promise<RequestAttachmentSummary[]>;
  /**
   * Active requirements of the request's service without a document in it, with the owner and the
   * status (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3); null when the request does not exist.
   */
  findMissingRequirements(
    requestId: string,
  ): Promise<{ requesterId: string; status: RequestStatus; requirements: ActiveDocumentRequirement[] } | null>;
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
  /** The business calendar in force (SPEC 2026-11-03-pausa-sla-calendario, 5.1 and 5.2). */
  loadBusinessCalendar(): Promise<BusinessCalendar>;
  findActor(actorId: string): Promise<TransactionActor | null>;
  findServiceForRequest(serviceId: string): Promise<ServiceForRequest | null>;
  /** Active document requirements of the service, in display order. */
  listActiveRequirements(serviceId: string): Promise<ActiveDocumentRequirement[]>;
  /** Returns the number of rows changed (0 when the approval was already decided). */
  updateApprovalIfCurrent(update: ApprovalUpdate): Promise<number>;
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.5: optional for older doubles. */
  approvalCoverage?(managerId: string): Promise<Array<{ sectorId: string; managerId: string }>>;
  insertApproval(approval: NewApproval): Promise<void>;
  /** Names of the active stages of the service, in flow order (SPEC de fluxos, 5.2). */
  listActiveStageNames(serviceId: string): Promise<string[]>;
  /**
   * The active stages with their settings, in flow order (SPEC
   * 2026-11-06-aprofundamento-configurabilidade, 5.3). Optional for older doubles: absent = names only.
   */
  listActiveStages?(serviceId: string): Promise<StageSettings[]>;
  /** The requester's answers given at the opening (5.3.3). */
  listOpeningAnswers?(requestId: string): Promise<OpeningAnswer[]>;
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
      /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.2: the levels copy, level 1 and its sector. */
      approvalSectorIdsSnapshot?: string[];
      approvalLevel?: number | null;
      approvalPendingSectorId?: string | null;
      /** 4.3.6: days per level and the first level's due date. */
      approvalDeadlineDaysSnapshot?: number | null;
      approvalDueAt?: Date | null;
      /** SPEC 2026-11-03-pausa-sla-calendario, 5.2 and 6. */
      slaBusinessHours?: boolean;
      dueSoonAt?: Date | null;
    },
  ): Promise<{ id: string }>;
  insertAttachments(attachments: NewRequestAttachment[]): Promise<void>;
  /** Documents already in the request (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.3). */
  listRequestDocuments(requestId: string): Promise<Array<{ requirementId: string; sizeBytes: number }>>;
  insertFieldValues(values: NewRequestFieldValue[]): Promise<void>;
  /** Active fields filled by the attendance (SPEC 2026-11-03-campos-condicionais-atendimento, 5.4). */
  listActiveAttendanceFields(serviceId: string): Promise<Array<AnswerableField & { helpText?: string | null }>>;
  /** Answers saved by the attendance (the ones with an author of the save). */
  listAttendanceAnswers(requestId: string): Promise<Array<{ fieldId: string; type: AnswerableField["type"]; value: string }>>;
  /** Writes the changed answers and removes the cleared ones (5.5.2). */
  saveAttendanceAnswers(change: AttendanceAnswersChange): Promise<void>;
  insertFieldUpdateEvent(event: NewFieldUpdateEvent): Promise<void>;
  /** Moves `updatedAt` only while status and assignee are the ones read; returns the rows changed. */
  touchRequestIfCurrent(update: { requestId: string; expectedStatus: RequestStatus; expectedAssigneeId: string | null; updatedAt: Date }): Promise<number>;
  /** Updates the status only while it still equals `expectedStatus`; returns the number of rows changed. */
  updateStatusIfCurrent(update: StatusUpdate): Promise<number>;
  insertStatusEvent(event: NewStatusEvent): Promise<void>;
  /** State needed by the lifecycle rules, with the current assignee as stored now. */
  findLifecycleState(requestId: string): Promise<LifecycleRequest | null>;
  findUserForAssignment(userId: string): Promise<LifecycleUser | null>;
  /** Permissions granted to a user, read in this transaction (SPEC de permissões, 5.2.4). */
  findPermissions(userId: string): Promise<Permission[]>;
  /** Returns the number of rows changed (0 when status or assignee changed meanwhile). */
  updateAssigneeIfCurrent(update: AssigneeUpdate): Promise<number>;
  insertAssignmentEvent(event: NewAssignmentEvent): Promise<void>;
  /** Returns the number of rows changed (0 when the request changed meanwhile). */
  updatePriorityIfCurrent(update: PriorityUpdate): Promise<number>;
  /** A sector with its count of active attendants, read in this transaction (5.2). */
  findSectorDestination(sectorId: string): Promise<SectorDestination | null>;
  /** Returns the number of rows changed (0 when the request changed meanwhile). */
  updateSectorIfCurrent(update: SectorUpdate): Promise<number>;
  insertSectorEvent(event: NewSectorEvent): Promise<void>;
  insertPriorityEvent(event: NewPriorityEvent): Promise<void>;
  /** Returns the number of rows changed (0 when the request changed meanwhile). */
  updateSlaPauseIfCurrent(update: SlaPauseUpdate): Promise<number>;
  /** Returns the id of the pause row. */
  insertSlaPause(pause: NewSlaPause): Promise<string>;
  /** Closes the open pause of the request; returns its id, or null when none was open. */
  closeOpenSlaPause(closing: SlaPauseClosing): Promise<string | null>;
  /** Writes a domain event to the outbox in this same transaction (SPEC de eventos, 6.2). */
  recordEvent(event: DomainEvent): Promise<void>;
  getWithHistory(requestId: string): Promise<RequestWithHistory>;
}

/** Runs work atomically with serializable isolation. */
export interface RequestTransactionRunner {
  run<T>(work: (transaction: RequestTransaction) => Promise<T>): Promise<T>;
}
