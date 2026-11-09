import { describe, expect, it } from "vitest";
import {
  MAX_COLLEAGUE_FOLLOWERS,
  assertCanRemoveFollower,
  autoFollowsOnComment,
  followerEventTitle,
  planAddFollower,
  readsAsFollower,
  type CurrentFollower,
  type FollowerPerson,
} from "@/modules/followers";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

// SPEC 2026-11-08-atendimento-dia-a-dia, part D and 13.3 (SF-211).

const rita: FollowerPerson = { id: "rita", role: "REQUESTER", isActive: true, sectorId: null };
const lia: FollowerPerson = { id: "lia", role: "REQUESTER", isActive: true, sectorId: null };
const ana: FollowerPerson = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "ti" };
const request = { requesterId: "rita", sectorId: "ti" };

describe("adding followers (6.3 item 1)", () => {
  it("the requester adds an active colleague; an attendant of the sector follows themselves", () => {
    expect(planAddFollower(rita, request, lia, [])).toBe("colleague");
    expect(planAddFollower(ana, request, ana, [])).toBe("attendant");
  });

  it("refuses a non-requester, an inactive colleague, the requester themselves, and an attendant adding someone else", () => {
    for (const target of [ana, { ...lia, isActive: false }, rita, null]) {
      expect(() => planAddFollower(rita, request, target, [])).toThrow(ValidationError);
    }
    expect(() => planAddFollower(ana, request, lia, [])).toThrow(ValidationError);
  });

  it("nobody else reaches the request: a colleague, another sector's attendant, a manager", () => {
    for (const actor of [lia, { ...ana, sectorId: "rh" }, { ...ana, role: "MANAGER" as const }, { ...rita, isActive: false }]) {
      expect(() => planAddFollower(actor, request, lia, [])).toThrow(NotFoundError);
    }
  });

  it("following twice is a conflict; up to 10 colleagues, attendants not counted", () => {
    expect(() => planAddFollower(rita, request, lia, [{ userId: "lia", role: "REQUESTER" }])).toThrow(ConflictError);
    expect(() => planAddFollower(ana, request, ana, [{ userId: "ana", role: "ATTENDANT" }])).toThrow(ConflictError);
    const ten: CurrentFollower[] = Array.from({ length: MAX_COLLEAGUE_FOLLOWERS }, (_, index) => ({ userId: `c${index}`, role: "REQUESTER" }));
    expect(() => planAddFollower(rita, request, lia, ten)).toThrow(ValidationError);
    expect(planAddFollower(rita, request, lia, [...ten.slice(1), { userId: "ana", role: "ATTENDANT" }])).toBe("colleague");
  });
});

describe("removing followers (6.3 item 1)", () => {
  const current: CurrentFollower[] = [
    { userId: "lia", role: "REQUESTER" },
    { userId: "ana", role: "ATTENDANT" },
  ];

  it("the requester removes a colleague; each follower removes themselves", () => {
    expect(() => assertCanRemoveFollower(rita, request, "lia", current)).not.toThrow();
    expect(() => assertCanRemoveFollower(lia, request, "lia", current)).not.toThrow();
    expect(() => assertCanRemoveFollower(ana, request, "ana", current)).not.toThrow();
  });

  it("the requester does not remove an attendant; nobody removes someone else; removing who does not follow is a conflict", () => {
    expect(() => assertCanRemoveFollower(rita, request, "ana", current)).toThrow(NotFoundError);
    expect(() => assertCanRemoveFollower(lia, request, "ana", current)).toThrow(NotFoundError);
    expect(() => assertCanRemoveFollower(rita, request, "rui", current)).toThrow(NotFoundError);
    expect(() => assertCanRemoveFollower(ana, request, "ana", [])).toThrow(ConflictError);
  });
});

describe("reading, history and the preference", () => {
  it("only an active colleague who follows reads as the requester (decision I13)", () => {
    expect(readsAsFollower(lia, ["lia"])).toBe(true);
    expect(readsAsFollower(lia, [])).toBe(false);
    expect(readsAsFollower({ ...lia, isActive: false }, ["lia"])).toBe(false);
    expect(readsAsFollower(ana, ["ana"])).toBe(false);
  });

  it("names the history's lines and defaults the preference to on (decision J7)", () => {
    expect(followerEventTitle({ action: "ADDED", userName: "Lia" })).toBe("Lia passou a acompanhar");
    expect(followerEventTitle({ action: "REMOVED", userName: "Lia" })).toBe("Lia deixou de acompanhar");
    expect(autoFollowsOnComment(null)).toBe(true);
    expect(autoFollowsOnComment({ autoFollowOnComment: false })).toBe(false);
  });
});
