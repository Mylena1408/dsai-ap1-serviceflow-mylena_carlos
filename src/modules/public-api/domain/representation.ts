import type { CommentRecord } from "@/modules/comments";
import type { DocumentRequirementRecord } from "@/modules/document-requirements";
import {
  approvalOverdue,
  pendingApprovalLevel,
  pendingApprovalSector,
  requestApprovalSectors,
  type RequestAttachmentSummary,
  type RequestFieldAnswer,
  type RequestLinkView,
  type GroupBlock,
  type RequestWithHistory,
  type SlaSituation,
} from "@/modules/requests";
import type { ServiceFieldRecord } from "@/modules/service-fields";
import type { PublishedService } from "@/modules/services";

// JSON of the /api/v1 answers (SPEC 2026-11-02-api-externa-webhooks, 5.4; decision A4): field names
// in English camelCase, dates in ISO 8601 UTC, statuses and priorities by their codes. Built only
// from what the use cases already return to the screen of the same person.

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

export interface ApiRequestContext {
  /** Effective assignee, as the screens show it. */
  assignee: { id: string; name: string } | null;
  slaSituation: SlaSituation;
  /** The moment of the answer, for "late" (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.6). */
  now?: Date;
}

/**
 * The approval of a service in the catalog (SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3):
 * the level sectors in order (the service's sector when none is configured), the days to decide
 * each level and the condition on an answer; null when the service does not require approval.
 */
export function serviceApprovalRepresentation(service: PublishedService) {
  if (!service.requiresApproval) return null;
  const levels = service.approvalSectorIds?.length ? service.approvalSectorIds : [service.sectorId];
  return {
    levelSectorIds: [...levels],
    deadlineDays: service.approvalDeadlineDays ?? null,
    condition: service.approvalConditionFieldId
      ? { fieldId: service.approvalConditionFieldId, value: service.approvalConditionValue ?? null }
      : null,
  };
}

/**
 * Where the approval of a request stands (4.3.3 to 4.3.6): the pending level and its sector, the
 * level sectors, the due date and whether it is late. Null without approval.
 */
export function approvalProgressRepresentation(request: RequestWithHistory, now: Date) {
  if (request.approvalState === null) return null;
  const sectors = requestApprovalSectors(request);
  return {
    state: request.approvalState,
    level: pendingApprovalLevel(request) ?? request.approvalLevel ?? sectors.length,
    levelCount: sectors.length,
    levelSectorIds: sectors,
    pendingSectorId: pendingApprovalSector(request),
    dueAt: iso(request.approvalDueAt),
    overdue: approvalOverdue(request, now),
  };
}

/** Every decision, by level, with the absent manager the decider replaced (4.3.3 and 4.3.5). */
export function approvalDecisionsRepresentation(request: RequestWithHistory) {
  return (request.approvals ?? (request.approval ? [request.approval] : [])).map((decision) => ({
    level: decision.level ?? 1,
    decision: decision.decision,
    decider: { id: decision.decider.id, name: decision.decider.name },
    onBehalfOf: decision.onBehalfOf ? { id: decision.onBehalfOf.id, name: decision.onBehalfOf.name } : null,
    note: decision.note,
    decidedAt: iso(decision.decidedAt),
  }));
}

export function serviceRepresentation(
  service: PublishedService,
  requirements: readonly DocumentRequirementRecord[],
  fields: readonly ServiceFieldRecord[],
) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    category: { id: service.category.id, name: service.category.name },
    sector: { id: service.sector.id, name: service.sector.name },
    defaultPriority: service.defaultPriority,
    slaHours: service.slaHours,
    requiresApproval: service.requiresApproval,
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.
    approval: serviceApprovalRepresentation(service),
    documents: requirements.map((requirement) => ({
      name: requirement.name,
      required: requirement.isRequired,
      formats: [...requirement.acceptedFormats],
    })),
    fields: fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.isRequired,
      helpText: field.helpText,
      options: [...field.options],
      minValue: field.minValue,
      maxValue: field.maxValue,
      // SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1: limits as text with a dot.
      decimalPlaces: field.decimalPlaces,
      minDecimal: field.minDecimal,
      maxDecimal: field.maxDecimal,
      // SPEC 2026-11-03-campos-condicionais-atendimento, 5.2: shown only when the condition is met.
      condition: field.conditionFieldId ? { fieldId: field.conditionFieldId, value: field.conditionValue } : null,
    })),
  };
}

export function requestSummaryRepresentation(request: RequestWithHistory, context: ApiRequestContext) {
  const stage = request.stageIndex === null ? null : (request.stageNamesSnapshot[request.stageIndex] ?? null);

  return {
    id: request.id,
    service: { id: request.serviceId, name: request.serviceNameSnapshot },
    category: { id: request.categoryIdSnapshot, name: request.categoryNameSnapshot },
    sector: { id: request.sectorId, name: request.sectorNameSnapshot },
    description: request.description,
    status: request.status,
    priority: request.priority,
    approval: request.approvalState,
    stage,
    assignee: context.assignee,
    createdAt: iso(request.createdAt),
    updatedAt: iso(request.updatedAt),
    completedAt: iso(request.completedAt),
    cancelledAt: iso(request.cancelledAt),
    dueAt: iso(request.dueAt),
    slaSituation: context.slaSituation,
    completedLate: request.completedLate,
  };
}

export function commentRepresentation(comment: CommentRecord) {
  return {
    id: comment.id,
    author: { id: comment.author.id, name: comment.author.name },
    body: comment.body,
    internal: comment.isInternal,
    createdAt: iso(comment.createdAt),
    // SPEC 2026-11-03-anexos-comentarios-documentos, decision X6: metadata only, no download.
    files: (comment.files ?? []).map((file) => ({
      id: file.id,
      fileName: file.removed ? null : file.originalFilename,
      format: file.detectedFormat,
      sizeBytes: file.sizeBytes,
      removed: file.removed,
    })),
  };
}

/**
 * A link of the request (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1): relation as read from
 * this request ("related", "duplicate_of", "original_of"), and the other request's code, service,
 * sector and status; `accessible` says whether the caller may read it.
 */
export function linkRepresentation(link: RequestLinkView) {
  return {
    id: link.id,
    relation: link.role,
    request: {
      id: link.other.id,
      code: link.other.id.slice(0, 8).toUpperCase(),
      service: link.other.serviceName,
      sector: link.other.sectorName,
      status: link.other.status,
      accessible: link.other.readable,
    },
  };
}

/**
 * The bundle of the request (SPEC 2026-11-07-operacao-e-automacao, 3.3 item 4, decision H4): its name,
 * the progress and the other requests with code, service, sector and status.
 */
export function groupRepresentation(group: GroupBlock) {
  return {
    id: group.groupId,
    name: group.bundleName,
    completed: group.progress.completed,
    cancelled: group.progress.cancelled,
    total: group.progress.total,
    closed: group.progress.closed,
    otherRequests: group.others.map((other) => ({
      id: other.id,
      code: other.id.slice(0, 8).toUpperCase(),
      service: other.serviceName,
      sector: other.sectorName,
      status: other.status,
      accessible: other.readable,
    })),
  };
}

export function requestDetailRepresentation(
  request: RequestWithHistory,
  context: ApiRequestContext,
  extra: {
    answers: readonly RequestFieldAnswer[];
    attachments: readonly RequestAttachmentSummary[];
    comments: readonly CommentRecord[];
    /** SPEC 2026-11-07-operacao-e-automacao, 3.3 item 1; optional for callers without links. */
    links?: readonly RequestLinkView[];
    /** 3.3 item 4; optional for callers without groups. */
    group?: GroupBlock | null;
  },
) {
  return {
    ...requestSummaryRepresentation(request, context),
    // SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.3 to 4.3.6.
    approvalProgress: approvalProgressRepresentation(request, context.now ?? new Date()),
    // SPEC 2026-11-03-pausa-sla-calendario, 5.8.3.
    slaBusinessHours: request.slaBusinessHours ?? false,
    slaPausedAt: iso(request.slaPausedAt),
    // "audience" (SPEC 2026-11-03-campos-condicionais-atendimento, 5.8.1): the attendance's answers
    // reach only the team, already filtered by the use case.
    fieldAnswers: extra.answers.map((answer) => ({ label: answer.label, type: answer.type, value: answer.value, audience: answer.audience ?? "REQUESTER" })),
    // Name, format and size only: the API has no download (section 4).
    attachments: extra.attachments.map((attachment) => ({
      id: attachment.id,
      document: attachment.requirementNameSnapshot,
      fileName: attachment.originalFilename,
      format: attachment.detectedFormat,
      sizeBytes: attachment.sizeBytes,
      removed: attachment.removedAt !== undefined,
    })),
    comments: extra.comments.map(commentRepresentation),
    links: (extra.links ?? []).map(linkRepresentation),
    group: extra.group ? groupRepresentation(extra.group) : null,
    history: {
      status: request.events.map((event) => ({
        from: event.fromStatus,
        to: event.toStatus,
        actor: { id: event.actor.id, name: event.actor.name },
        note: event.note,
        occurredAt: iso(event.occurredAt),
      })),
      assignment: request.assignmentEvents.map((event) => ({
        from: event.fromAssignee && { id: event.fromAssignee.id, name: event.fromAssignee.name },
        to: event.toAssignee && { id: event.toAssignee.id, name: event.toAssignee.name },
        // Null when the system made the change (SPEC 2026-11-06-aprofundamento-configurabilidade, G17), with
        // the reason (SPEC 2026-11-07-operacao-e-automacao, 4.4).
        actor: event.actor && { id: event.actor.id, name: event.actor.name },
        reason: event.reason ?? null,
        occurredAt: iso(event.occurredAt),
      })),
      priority: request.priorityEvents.map((event) => ({
        from: event.fromPriority,
        to: event.toPriority,
        actor: { id: event.actor.id, name: event.actor.name },
        occurredAt: iso(event.occurredAt),
      })),
      // SPEC 2026-11-03-transferencia-entre-setores, 5.4 and 5.5: the same moves the screen shows.
      sectors: (request.sectorEvents ?? []).map((event) => ({
        from: { id: event.fromSectorId, name: event.fromSectorName },
        to: { id: event.toSectorId, name: event.toSectorName },
        actor: { id: event.actor.id, name: event.actor.name },
        note: event.note,
        occurredAt: iso(event.occurredAt),
      })),
      // SPEC 2026-11-03-pausa-sla-calendario, 5.8.3: the same pauses the screen shows.
      pauses: (request.slaPauses ?? []).map((pause) => ({
        reason: pause.reason,
        pausedBy: { id: pause.pausedBy.id, name: pause.pausedBy.name },
        pausedAt: iso(pause.pausedAt),
        resumedAt: iso(pause.resumedAt),
        resumedBy: pause.resumedBy && { id: pause.resumedBy.id, name: pause.resumedBy.name },
        resumeCause: pause.resumeCause,
      })),
      stages: request.stageEvents.map((event) => ({
        from: event.fromStage,
        to: event.toStage,
        actor: { id: event.actor.id, name: event.actor.name },
        note: event.note,
        occurredAt: iso(event.occurredAt),
      })),
      // The last decision, as before levels; "approvals" has every level.
      approval: request.approval && {
        decision: request.approval.decision,
        decider: { id: request.approval.decider.id, name: request.approval.decider.name },
        note: request.approval.note,
        decidedAt: iso(request.approval.decidedAt),
      },
      approvals: approvalDecisionsRepresentation(request),
    },
  };
}

export interface ApiPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}
