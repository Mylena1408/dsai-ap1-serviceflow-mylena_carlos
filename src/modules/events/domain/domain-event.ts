// Domain events written to the outbox (SPEC 2026-10-31-eventos-outbox-jobs, section 6).
// Payloads carry identifiers and codes only: never comment text, reasons, file names or
// personal data. Consumers reload whatever else they need from the database.

export type EventRequestStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type EventRequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type DomainEvent =
  | {
      type: "request.opened";
      requestId: string;
      occurredAt: Date;
      payload: { requesterId: string; sectorId: string };
    }
  | {
      type: "request.status_changed";
      requestId: string;
      occurredAt: Date;
      payload: { fromStatus: EventRequestStatus; toStatus: EventRequestStatus; actorId: string };
    }
  | {
      type: "request.assignment_changed";
      requestId: string;
      occurredAt: Date;
      // actorId is null for an escalation rule's handover (SPEC 2026-11-06-aprofundamento-configurabilidade, G17).
      payload: { fromAssigneeId: string | null; toAssigneeId: string | null; actorId: string | null };
    }
  | {
      type: "request.comment_added";
      requestId: string;
      occurredAt: Date;
      payload: { commentId: string; authorId: string; isInternal: boolean };
    }
  | {
      type: "request.priority_changed";
      requestId: string;
      occurredAt: Date;
      payload: { fromPriority: EventRequestPriority; toPriority: EventRequestPriority; actorId: string };
    }
  | {
      // Stage entered (SPEC 2026-11-01-fluxos-configuraveis, 5.5): the consumer reloads the
      // stage names from the history row, so the payload keeps identifiers and codes only.
      type: "request.stage_changed";
      requestId: string;
      occurredAt: Date;
      payload: { stageEventId: string; direction: "start" | "advance" | "return"; actorId: string };
    }
  | {
      // Manager decision (SPEC 2026-11-01-aprovacoes, 5.6); the note stays in the record.
      type: "request.approval_decided";
      requestId: string;
      occurredAt: Date;
      // Level and next level's sector: SPEC 2026-11-06-aprofundamento-configurabilidade, 4.3.8.
      payload: { decision: "APPROVED" | "REJECTED"; actorId: string; level: number; nextSectorId: string | null };
    }
  | {
      // Request sent to another sector (SPEC 2026-11-03-transferencia-entre-setores, 5.3.5); the
      // note stays in the history row.
      type: "request.sector_changed";
      requestId: string;
      occurredAt: Date;
      payload: { fromSectorId: string; toSectorId: string; actorId: string };
    }
  | {
      // Document sent after the opening (SPEC 2026-11-03-anexos-comentarios-documentos, 5.3.6).
      type: "request.document_added";
      requestId: string;
      occurredAt: Date;
      payload: { attachmentId: string; actorId: string };
    }
  | {
      // SLA pause and resume (SPEC 2026-11-03-pausa-sla-calendario, 5.8.1); the reason stays in
      // the pause row. A resume caused by the end of the attendance has the actor who ended it.
      type: "request.sla_paused";
      requestId: string;
      occurredAt: Date;
      payload: { pauseId: string; actorId: string };
    }
  | {
      type: "request.sla_resumed";
      requestId: string;
      occurredAt: Date;
      payload: { pauseId: string; actorId: string; cause: "manual" | "requester_reply" | "attendance_ended" };
    }
  | {
      // The current stage passed its target (SPEC 2026-11-06-aprofundamento-configurabilidade, 5.3.2).
      // Written by the daily job, once per stage entry; the index identifies the stage of the copy.
      type: "request.stage_overdue";
      requestId: string;
      occurredAt: Date;
      payload: { stageIndex: number };
    }
  | {
      // An escalation rule applied to the request (SPEC 2026-11-06-aprofundamento-configurabilidade,
      // 7.3); the consumer reloads the escalation row for the people to warn.
      type: "request.escalated";
      requestId: string;
      occurredAt: Date;
      payload: { escalationId: string };
    }
  | {
      // A pending approval level passed its deadline (SPEC 2026-11-06-aprofundamento-configurabilidade,
      // 4.3.6). Written by the daily job, once per level; the sector names who decides it.
      type: "request.approval_overdue";
      requestId: string;
      occurredAt: Date;
      payload: { level: number; sectorId: string };
    }
  | {
      // SLA alerts of the daily job (SPEC 2026-11-01, section 5.5). No actor: the job
      // writes them, and the consumer reloads the request to find the recipients.
      type: "request.sla_warning" | "request.sla_breached";
      requestId: string;
      occurredAt: Date;
      payload: Record<string, never>;
    };

export type DomainEventType = DomainEvent["type"];

export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = [
  "request.opened",
  "request.status_changed",
  "request.assignment_changed",
  "request.comment_added",
  "request.priority_changed",
  "request.sla_warning",
  "request.sla_breached",
  "request.stage_changed",
  "request.approval_decided",
  "request.sector_changed",
  "request.document_added",
  "request.sla_paused",
  "request.sla_resumed",
  "request.approval_overdue",
  "request.stage_overdue",
  "request.escalated",
];

const PAYLOAD_KEYS: Record<DomainEventType, readonly string[]> = {
  "request.opened": ["requesterId", "sectorId"],
  "request.status_changed": ["fromStatus", "toStatus", "actorId"],
  "request.assignment_changed": ["fromAssigneeId", "toAssigneeId", "actorId"],
  "request.comment_added": ["commentId", "authorId", "isInternal"],
  "request.priority_changed": ["fromPriority", "toPriority", "actorId"],
  "request.sla_warning": [],
  "request.sla_breached": [],
  "request.stage_changed": ["stageEventId", "direction", "actorId"],
  "request.approval_decided": ["decision", "actorId", "level", "nextSectorId"],
  "request.sector_changed": ["fromSectorId", "toSectorId", "actorId"],
  "request.document_added": ["attachmentId", "actorId"],
  "request.sla_paused": ["pauseId", "actorId"],
  "request.sla_resumed": ["pauseId", "actorId", "cause"],
  "request.approval_overdue": ["level", "sectorId"],
  "request.stage_overdue": ["stageIndex"],
  "request.escalated": ["escalationId"],
};

/**
 * Copies only the declared payload keys, so a caller that passes a richer object (for
 * example a whole comment) cannot leak text into the outbox (section 6.1, CA-EVT-02).
 */
export function outboxPayload(event: DomainEvent): Record<string, string | number | boolean | null> {
  const source = event.payload as Record<string, string | number | boolean | null>;
  return Object.fromEntries(PAYLOAD_KEYS[event.type].map((key) => [key, source[key] ?? null]));
}
