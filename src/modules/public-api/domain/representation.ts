import type { CommentRecord } from "@/modules/comments";
import type { DocumentRequirementRecord } from "@/modules/document-requirements";
import type { RequestAttachmentSummary, RequestFieldAnswer, RequestWithHistory, SlaSituation } from "@/modules/requests";
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

export function requestDetailRepresentation(
  request: RequestWithHistory,
  context: ApiRequestContext,
  extra: {
    answers: readonly RequestFieldAnswer[];
    attachments: readonly RequestAttachmentSummary[];
    comments: readonly CommentRecord[];
  },
) {
  return {
    ...requestSummaryRepresentation(request, context),
    fieldAnswers: extra.answers.map((answer) => ({ label: answer.label, type: answer.type, value: answer.value })),
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
        actor: { id: event.actor.id, name: event.actor.name },
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
      stages: request.stageEvents.map((event) => ({
        from: event.fromStage,
        to: event.toStage,
        actor: { id: event.actor.id, name: event.actor.name },
        note: event.note,
        occurredAt: iso(event.occurredAt),
      })),
      approval: request.approval && {
        decision: request.approval.decision,
        decider: { id: request.approval.decider.id, name: request.approval.decider.name },
        note: request.approval.note,
        decidedAt: iso(request.approval.decidedAt),
      },
    },
  };
}

export interface ApiPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}
