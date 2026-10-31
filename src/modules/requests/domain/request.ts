export type RequestStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface RequestRecord {
  id: string;
  requesterId: string;
  serviceId: string;
  sectorId: string;
  serviceNameSnapshot: string;
  serviceDescriptionSnapshot: string;
  categoryIdSnapshot: string;
  categoryNameSnapshot: string;
  sectorNameSnapshot: string;
  description: string;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  /** Individual attendant in charge, when someone assumed the request (SPEC 2026-10-31). */
  assigneeId: string | null;
  cancelledAt: Date | null;
}

export interface RequestStatusEventRecord {
  id: string;
  requestId: string;
  actorId: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  occurredAt: Date;
  /** Cancellation or reopening reason. */
  note: string | null;
  actor: {
    id: string;
    name: string;
    email: string;
  };
}

export interface RequestWithHistory extends RequestRecord {
  events: RequestStatusEventRecord[];
  service: {
    id: string;
    isActive: boolean;
  };
  /** Stored assignee, effective or not (SPEC 2026-10-31, section 5.1). */
  assignee: {
    id: string;
    name: string;
    role: "ADMIN" | "REQUESTER" | "ATTENDANT";
    isActive: boolean;
    sectorId: string | null;
  } | null;
}

export type RequestSummary = Pick<
  RequestRecord,
  | "id"
  | "status"
  | "description"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "serviceNameSnapshot"
  | "serviceDescriptionSnapshot"
  | "categoryNameSnapshot"
  | "sectorNameSnapshot"
>;
