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
  /** SPEC 2026-11-01-fluxos-configuraveis: flow copy taken at the start and current stage. */
  stageNamesSnapshot: string[];
  stageIndex: number | null;
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

export interface RequestPriorityEventRecord {
  id: string;
  requestId: string;
  actorId: string;
  fromPriority: RequestPriority;
  toPriority: RequestPriority;
  occurredAt: Date;
  actor: { id: string; name: string };
}

/** Entry into a stage of the flow copy (SPEC 2026-11-01-fluxos-configuraveis, 5.5). */
export interface RequestStageEventRecord {
  id: string;
  requestId: string;
  actorId: string;
  fromStage: string | null;
  toStage: string;
  /** Reason, only when going back. */
  note: string | null;
  occurredAt: Date;
  actor: { id: string; name: string };
}

export interface RequestWithHistory extends RequestRecord {
  events: RequestStatusEventRecord[];
  /** Priority changes (SPEC 2026-11-01, section 6). */
  priorityEvents: RequestPriorityEventRecord[];
  /** Stage entries and moves (SPEC 2026-11-01-fluxos-configuraveis, 5.5). */
  stageEvents: RequestStageEventRecord[];
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
    role: "ADMIN" | "REQUESTER" | "ATTENDANT" | "MANAGER";
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
