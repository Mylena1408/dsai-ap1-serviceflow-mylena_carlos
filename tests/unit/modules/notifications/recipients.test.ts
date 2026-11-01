import { describe, expect, it } from "vitest";
import { plannedNotifications, type NotifiableEvent } from "@/modules/notifications/domain/recipients";

// SPEC 2026-10-31-eventos-outbox-jobs, section 8.1 (CA-EVT-06).

const held = { requesterId: "rita", effectiveAssigneeId: "ana" };
const unheld = { requesterId: "rita", effectiveAssigneeId: null };

const status = (toStatus: string, actorId: string): NotifiableEvent => ({
  type: "request.status_changed",
  payload: { toStatus, actorId },
});
const comment = (authorId: string, isInternal = false): NotifiableEvent => ({
  type: "request.comment_added",
  payload: { authorId, isInternal },
});

describe("notification recipients", () => {
  it("tells the requester about status changes made by attendants", () => {
    for (const toStatus of ["IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
      expect(plannedNotifications(status(toStatus, "ana"), held)).toEqual([
        { recipientId: "rita", type: `status.${toStatus}` },
      ]);
    }
  });

  it("tells the effective assignee when the requester cancels or reopens, and nobody without one (E4)", () => {
    expect(plannedNotifications(status("CANCELLED", "rita"), held)).toEqual([
      { recipientId: "ana", type: "status.CANCELLED" },
    ]);
    expect(plannedNotifications(status("OPEN", "rita"), held)).toEqual([{ recipientId: "ana", type: "status.OPEN" }]);
    expect(plannedNotifications(status("CANCELLED", "rita"), unheld)).toEqual([]);
  });

  it("notifies only transfers, never the actor", () => {
    const assignment = (toAssigneeId: string | null, actorId: string): NotifiableEvent => ({
      type: "request.assignment_changed",
      payload: { toAssigneeId, actorId },
    });
    expect(plannedNotifications(assignment("bia", "ana"), held)).toEqual([
      { recipientId: "bia", type: "assignment.received" },
    ]);
    expect(plannedNotifications(assignment("ana", "ana"), held)).toEqual([]);
    expect(plannedNotifications(assignment(null, "ana"), held)).toEqual([]);
  });

  it("routes comments to the other side and internal notes to the assignee only", () => {
    expect(plannedNotifications(comment("ana"), held)).toEqual([{ recipientId: "rita", type: "comment.public" }]);
    expect(plannedNotifications(comment("bia"), held)).toEqual([{ recipientId: "rita", type: "comment.public" }]);
    expect(plannedNotifications(comment("rita"), held)).toEqual([{ recipientId: "ana", type: "comment.public" }]);
    expect(plannedNotifications(comment("rita"), unheld)).toEqual([]);
    expect(plannedNotifications(comment("bia", true), held)).toEqual([{ recipientId: "ana", type: "comment.internal" }]);
    expect(plannedNotifications(comment("ana", true), held)).toEqual([]);
    expect(plannedNotifications(comment("bia", true), unheld)).toEqual([]);
  });

  it("ignores the opening and unknown statuses", () => {
    expect(plannedNotifications({ type: "request.opened" }, held)).toEqual([]);
    expect(plannedNotifications(status("UNKNOWN", "ana"), held)).toEqual([]);
  });
});
