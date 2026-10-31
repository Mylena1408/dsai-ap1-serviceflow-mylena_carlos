import type { DetectedDocumentFormat } from "@/modules/attachments";
import type { RequestAttachmentSummary, StoredRequestAttachment } from "../domain/attachment";
import type { ActiveDocumentRequirement } from "../domain/attachment-requirements";
import type { RequestStatus, RequestWithHistory } from "../domain/request";
import type { RequestSnapshot } from "../domain/snapshot";

export type ActorRole = "ADMIN" | "REQUESTER" | "ATTENDANT";

export interface RequestQueryRepository {
  listByRequester(requesterId: string): Promise<RequestWithHistory[]>;
  findForRequester(requestId: string, requesterId: string): Promise<RequestWithHistory | null>;
  listBySector(sectorId: string): Promise<RequestWithHistory[]>;
  findInSector(requestId: string, sectorId: string): Promise<RequestWithHistory | null>;
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
  toStatus: RequestStatus;
  updatedAt: Date;
  completedAt?: Date;
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
export interface AttachmentStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Reads the content of attachments that are referenced by a database row. */
export interface AttachmentContentReader {
  get(key: string): Promise<Uint8Array>;
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
  insertRequest(
    data: RequestSnapshot & {
      id: string;
      description: string;
      status: RequestStatus;
      openedAt: Date;
    },
  ): Promise<{ id: string }>;
  insertAttachments(attachments: NewRequestAttachment[]): Promise<void>;
  findRequestState(requestId: string): Promise<{ status: RequestStatus; sectorId: string } | null>;
  /** Updates the status only while it still equals `expectedStatus`; returns the number of rows changed. */
  updateStatusIfCurrent(update: StatusUpdate): Promise<number>;
  insertStatusEvent(event: NewStatusEvent): Promise<void>;
  getWithHistory(requestId: string): Promise<RequestWithHistory>;
}

/** Runs work atomically with serializable isolation. */
export interface RequestTransactionRunner {
  run<T>(work: (transaction: RequestTransaction) => Promise<T>): Promise<T>;
}
