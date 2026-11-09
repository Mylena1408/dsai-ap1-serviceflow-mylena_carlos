import { describe, expect, it } from "vitest";
import { MAX_MENTIONS, mentionLine, planMentions } from "@/modules/comments/domain/mentions";
import { plannedNotifications, type NotificationContext } from "@/modules/notifications/domain/recipients";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-08-atendimento-dia-a-dia, part E (SF-215; decisions I15 and I16).

const sector = new Set(["ana", "bia", "carla", "davi", "edu", "fabi", "gil"]);

describe("choosing whom to mention (7.3 item 1)", () => {
  it("keeps the active attendants of the sector, without repeats or the author", () => {
    expect(planMentions(["bia", "carla", "bia", "ana"], { authorId: "ana", isInternal: true, mentionableIds: sector })).toEqual(["bia", "carla"]);
    expect(planMentions([], { authorId: "ana", isInternal: false, mentionableIds: sector })).toEqual([]);
  });

  it("refuses mentions in a public comment, of anyone else, and more than 5", () => {
    expect(() => planMentions(["bia"], { authorId: "ana", isInternal: false, mentionableIds: sector })).toThrow(ValidationError);
    expect(() => planMentions(["gestor"], { authorId: "ana", isInternal: true, mentionableIds: sector })).toThrow(ValidationError);
    const six = ["bia", "carla", "davi", "edu", "fabi", "gil"];
    expect(six.length).toBe(MAX_MENTIONS + 1);
    expect(() => planMentions(six, { authorId: "ana", isInternal: true, mentionableIds: sector })).toThrow(ValidationError);
  });

  it("writes the line shown with the note (7.3 item 3)", () => {
    expect(mentionLine(["Bia", "Carla"])).toBe("Menciona: Bia, Carla");
    expect(mentionLine([])).toBeNull();
  });
});

describe("the mention's notice (7.3 item 2)", () => {
  const context: NotificationContext = { requesterId: "rita", effectiveAssigneeId: "ana", mentionedIds: ["ana", "bia"] };
  const note = (authorId: string) => ({ type: "request.comment_added", payload: { authorId, isInternal: true } }) as const;
  const sorted = (items: Array<{ recipientId: string; type: string }>) => items.map(({ recipientId, type }) => `${recipientId}:${type}`).sort();

  it("each mentioned person hears once, as a mention, even the assignee; never the author", () => {
    expect(sorted(plannedNotifications(note("carla"), context))).toEqual(["ana:comment.mention", "bia:comment.mention"]);
    expect(sorted(plannedNotifications(note("bia"), context))).toEqual(["ana:comment.mention"]);
  });

  it("a following attendant hears of the note as a note; a mentioned follower hears once", () => {
    const withFollowers = { ...context, mentionedIds: ["bia"], followers: { colleagueIds: [], attendantIds: ["bia", "davi"] } };
    expect(sorted(plannedNotifications(note("carla"), withFollowers))).toEqual(["ana:comment.internal", "bia:comment.mention", "davi:comment.internal"]);
  });

  it("without mentions, nothing changes (CA-MEN-01)", () => {
    expect(plannedNotifications(note("carla"), { requesterId: "rita", effectiveAssigneeId: "ana" })).toEqual([{ recipientId: "ana", type: "comment.internal" }]);
  });
});
