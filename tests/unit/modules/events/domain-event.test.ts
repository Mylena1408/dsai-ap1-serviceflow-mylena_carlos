import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPES, outboxPayload, type DomainEvent } from "@/modules/events";

// SPEC 2026-10-31-eventos-outbox-jobs, section 6.1 (SF-061).

const occurredAt = new Date("2026-11-01T12:00:00.000Z");

describe("outbox payload (CA-EVT-02)", () => {
  it("keeps only the declared identifiers and codes", () => {
    const leaky = {
      type: "request.comment_added",
      requestId: "r",
      occurredAt,
      payload: { commentId: "c", authorId: "a", isInternal: true, body: "texto secreto", note: "x" },
    } as unknown as DomainEvent;

    expect(outboxPayload(leaky)).toEqual({ commentId: "c", authorId: "a", isInternal: true });
  });

  it("covers every event type with null for absent identifiers", () => {
    expect(DOMAIN_EVENT_TYPES).toEqual([
      "request.opened",
      "request.status_changed",
      "request.assignment_changed",
      "request.comment_added",
      // Added by SPEC 2026-11-01 (SLA e prioridades).
      "request.priority_changed",
    ]);
    expect(
      outboxPayload({
        type: "request.assignment_changed",
        requestId: "r",
        occurredAt,
        payload: { fromAssigneeId: null, toAssigneeId: "b", actorId: "b" },
      }),
    ).toEqual({ fromAssigneeId: null, toAssigneeId: "b", actorId: "b" });
    expect(
      outboxPayload({
        type: "request.status_changed",
        requestId: "r",
        occurredAt,
        payload: { fromStatus: "COMPLETED", toStatus: "OPEN", actorId: "o" },
      }),
    ).toEqual({ fromStatus: "COMPLETED", toStatus: "OPEN", actorId: "o" });
  });
});
