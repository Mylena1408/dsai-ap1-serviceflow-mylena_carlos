import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { RequestFollowers, followMessage } from "@/app/_components/request-followers";
import { buildTimeline } from "@/app/_components/request-timeline";
import type { RequestFollowersView } from "@/modules/followers";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 6.3 items 1 and 4 (SF-214).

const view = (overrides: Partial<RequestFollowersView> = {}): RequestFollowersView => ({
  viewerId: "rita",
  followers: [
    { userId: "lia", name: "Lia", kind: "colleague" },
    { userId: "ana", name: "Ana", kind: "attendant" },
  ],
  events: [],
  canAddColleague: true,
  canFollowSelf: false,
  canStopFollowing: false,
  removableIds: ["lia"],
  ...overrides,
});
const render = (props: Parameters<typeof RequestFollowers>[0]) => renderToStaticMarkup(createElement(RequestFollowers, props));

describe("the followers block", () => {
  it("the requester sees the names, adds a colleague by e-mail and removes colleagues, never an attendant", () => {
    const html = render({ requestId: "r1", view: view(), area: "requester" });
    expect(html).toContain("Lia");
    expect(html).toContain("(colega)");
    expect(html).toContain("(equipe)");
    expect(html).toContain('aria-label="Incluir colega"');
    expect(html).toContain("Retirar Lia");
    expect(html).not.toContain("Retirar Ana");
    // No contact data.
    expect(html).not.toContain("@");
  });

  it("an attendant follows or stops; a colleague stops; the manager only reads", () => {
    const attendant = view({ viewerId: "bia", canAddColleague: false, removableIds: [], canFollowSelf: true });
    expect(render({ requestId: "r1", view: attendant, area: "queue" })).toContain(">Acompanhar<");
    const colleague = view({ viewerId: "lia", canAddColleague: false, removableIds: [], canStopFollowing: true });
    const html = render({ requestId: "r1", view: colleague, area: "following" });
    expect(html).toContain("Deixar de acompanhar");
    expect(html).toContain('type="hidden" name="userId" value="lia"');
    expect(render({ requestId: "r1", view: view({ canStopFollowing: true }), area: "manager" })).not.toContain("<form");
  });

  it("says when nobody follows, explains each result, and names the history's lines", () => {
    expect(render({ requestId: "r1", view: view({ followers: [], removableIds: [] }), area: "requester" })).toContain("Ninguém acompanha");
    expect(followMessage("follow-invalid")?.error).toBe(true);
    expect(followMessage("other")).toBeNull();
    const request = { createdAt: new Date("2026-11-09T10:00:00Z"), events: [], assignmentEvents: [], priorityEvents: [], stageEvents: [] } as unknown as RequestWithHistory;
    const entries = buildTimeline(request, [], [], [], [], [
      { id: "f1", occurredAt: new Date("2026-11-09T11:00:00Z"), action: "ADDED", userName: "Lia", actorName: "Rita" },
      { id: "f2", occurredAt: new Date("2026-11-09T12:00:00Z"), action: "REMOVED", userName: "Lia", actorName: "Lia" },
    ]);
    expect(entries.map(({ title, actor }) => [title, actor])).toEqual([
      ["Lia passou a acompanhar", "Rita"],
      ["Lia deixou de acompanhar", "Lia"],
    ]);
  });
});
