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
}

export interface StatusUpdate {
  requestId: string;
  sectorId: string;
  expectedStatus: RequestStatus;
  toStatus: RequestStatus;
  updatedAt: Date;
  completedAt?: Date;
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
  insertRequest(
    data: RequestSnapshot & { description: string; status: RequestStatus; openedAt: Date },
  ): Promise<{ id: string }>;
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
