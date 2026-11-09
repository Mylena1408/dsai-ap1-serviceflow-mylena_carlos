import { describe, expect, it } from "vitest";
import { plannedNotifications, type NotificationContext } from "@/modules/notifications/domain/recipients";

// SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 item 3 (SF-213; decision I12).

const base: NotificationContext = {
  requesterId: "rita",
  effectiveAssigneeId: "ana",
  followers: { colleagueIds: ["lia", "rui"], attendantIds: ["bia"] },
};

const sorted = (items: Array<{ recipientId: string; type: string }>) => items.map(({ recipientId, type }) => `${recipientId}:${type}`).sort();

describe("notices to followers", () => {
  it("what reaches the requester also reaches each colleague who follows", () => {
    expect(sorted(plannedNotifications({ type: "request.comment_added", payload: { authorId: "ana", isInternal: false } }, base))).toEqual([
      "lia:comment.public",
      "rita:comment.public",
      "rui:comment.public",
    ]);
    expect(sorted(plannedNotifications({ type: "request.status_changed", payload: { toStatus: "COMPLETED", actorId: "ana" } }, base))).toEqual([
      "lia:status.COMPLETED",
      "rita:status.COMPLETED",
      "rui:status.COMPLETED",
    ]);
  });

  it("what reaches the team also reaches the attendants who follow, internal notes included", () => {
    expect(sorted(plannedNotifications({ type: "request.comment_added", payload: { authorId: "rita", isInternal: false } }, base))).toEqual([
      "ana:comment.public",
      "bia:comment.public",
    ]);
    expect(sorted(plannedNotifications({ type: "request.comment_added", payload: { authorId: "carla", isInternal: true } }, base))).toEqual([
      "ana:comment.internal",
      "bia:comment.internal",
    ]);
  });

  it("never the author and never twice; colleagues never get the team's notices", () => {
    // The following attendant writes the note: neither they nor the colleagues hear of it.
    expect(sorted(plannedNotifications({ type: "request.comment_added", payload: { authorId: "bia", isInternal: true } }, base))).toEqual([
      "ana:comment.internal",
    ]);
    // A colleague who also is the assignee hears once.
    const twice = { ...base, followers: { colleagueIds: [], attendantIds: ["ana"] } };
    expect(sorted(plannedNotifications({ type: "request.comment_added", payload: { authorId: "rita", isInternal: false } }, twice))).toEqual([
      "ana:comment.public",
    ]);
  });

  it("without followers, nothing changes (CA-SEG-01)", () => {
    const event = { type: "request.stage_changed", payload: { direction: "advance", actorId: "ana" } } as const;
    expect(plannedNotifications(event, { ...base, followers: undefined })).toEqual([{ recipientId: "rita", type: "stage.changed" }]);
    expect(plannedNotifications(event, { ...base, followers: { colleagueIds: [], attendantIds: [] } })).toEqual([{ recipientId: "rita", type: "stage.changed" }]);
  });
});
