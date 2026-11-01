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
      payload: { fromAssigneeId: string | null; toAssigneeId: string | null; actorId: string };
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
};

/**
 * Copies only the declared payload keys, so a caller that passes a richer object (for
 * example a whole comment) cannot leak text into the outbox (section 6.1, CA-EVT-02).
 */
export function outboxPayload(event: DomainEvent): Record<string, string | boolean | null> {
  const source = event.payload as Record<string, string | boolean | null>;
  return Object.fromEntries(PAYLOAD_KEYS[event.type].map((key) => [key, source[key] ?? null]));
}
