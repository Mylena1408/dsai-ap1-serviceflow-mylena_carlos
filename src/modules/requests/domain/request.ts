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
  /** SPEC 2026-11-01-aprovacoes: null when the service did not require approval. */
  approvalState: "PENDING" | "APPROVED" | "REJECTED" | null;
  /**
   * SPEC 2026-11-06-aprofundamento-configurabilidade, 4.4: level sectors copied at the opening
   * (empty before levels: one level, the request's sector), current level and its sector while
   * pending. Optional so older records stay valid.
   */
  approvalSectorIdsSnapshot?: string[];
  approvalLevel?: number | null;
  approvalPendingSectorId?: string | null;
  /** SPEC 2026-11-03-pausa-sla-calendario, 5.2 and 5.3; optional so older records stay valid. */
  slaBusinessHours?: boolean;
  dueSoonAt?: Date | null;
  slaPausedAt?: Date | null;
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

/** Request sent to another sector (SPEC 2026-11-03-transferencia-entre-setores, 5.3 and 5.5). */
export interface RequestSectorEventRecord {
  id: string;
  requestId: string;
  actorId: string;
  fromSectorId: string;
  toSectorId: string;
  /** Names at the time of the move. */
  fromSectorName: string;
  toSectorName: string;
  note: string;
  occurredAt: Date;
  actor: { id: string; name: string };
}

/** An SLA pause and its resume (SPEC 2026-11-03-pausa-sla-calendario, 5.5). */
export interface RequestSlaPauseRecord {
  id: string;
  requestId: string;
  pausedById: string;
  reason: string;
  pausedAt: Date;
  resumedAt: Date | null;
  resumedById: string | null;
  resumeCause: "MANUAL" | "REQUESTER_REPLY" | "ATTENDANCE_ENDED" | null;
  pausedBy: { id: string; name: string };
  resumedBy: { id: string; name: string } | null;
}

/** Manager decision (SPEC 2026-11-01-aprovacoes, 5.6). */
export interface RequestApprovalRecord {
  id: string;
  requestId: string;
  deciderId: string;
  decision: "APPROVED" | "REJECTED";
  note: string | null;
  decidedAt: Date;
  decider: { id: string; name: string };
  /** SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3: 1 for decisions made before levels. */
  level?: number;
}

export interface RequestWithHistory extends RequestRecord {
  events: RequestStatusEventRecord[];
  /** Priority changes (SPEC 2026-11-01, section 6). */
  priorityEvents: RequestPriorityEventRecord[];
  /** Stage entries and moves (SPEC 2026-11-01-fluxos-configuraveis, 5.5). */
  stageEvents: RequestStageEventRecord[];
  /** The last approval decision, when one was made (SPEC 2026-11-01-aprovacoes, 5.6). */
  approval: RequestApprovalRecord | null;
  /** Every decision, by level (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3). */
  approvals?: RequestApprovalRecord[];
  /** Assume, release and transfer events (SPEC 2026-10-31, section 5.9). */
  assignmentEvents: RequestAssignmentEventRecord[];
  /**
   * Moves to other sectors (SPEC 2026-11-03-transferencia-entre-setores, 5.5). Always loaded from
   * the database; optional so records built before that SPEC stay valid.
   */
  sectorEvents?: RequestSectorEventRecord[];
  /**
   * Documents of the request, only what the history needs: the ones sent after the opening become
   * history lines (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.5). Optional like sectorEvents.
   */
  attachments?: Array<{ id: string; requirementNameSnapshot: string; createdAt: Date; uploadedBy: { id: string; name: string } }>;
  /** SLA pauses (SPEC 2026-11-03-pausa-sla-calendario, 5.5). Optional like sectorEvents. */
  slaPauses?: RequestSlaPauseRecord[];
  /**
   * Saves of the attendance fields, labels only (SPEC 2026-11-03-campos-condicionais-atendimento,
   * 5.5.3). Only the team sees them; optional like sectorEvents.
   */
  fieldUpdates?: Array<{ id: string; labels: string[]; occurredAt: Date; actor: { id: string; name: string } }>;
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
