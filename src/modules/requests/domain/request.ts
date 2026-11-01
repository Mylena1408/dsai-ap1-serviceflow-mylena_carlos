export type RequestStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type RequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

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
  /** SPEC 2026-11-01 (SLA e prioridades). */
  priority: RequestPriority;
  slaHoursSnapshot: number | null;
  dueAt: Date | null;
  completedLate: boolean | null;
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

export interface RequestAssignmentEventRecord {
  id: string;
  requestId: string;
  actorId: string;
  fromAssigneeId: string | null;
  toAssigneeId: string | null;
  occurredAt: Date;
  actor: { id: string; name: string };
  fromAssignee: { id: string; name: string } | null;
  toAssignee: { id: string; name: string } | null;
}

export interface RequestWithHistory extends RequestRecord {
  events: RequestStatusEventRecord[];
  /** Assume, release and transfer events (SPEC 2026-10-31, section 5.9). */
  assignmentEvents: RequestAssignmentEventRecord[];
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
