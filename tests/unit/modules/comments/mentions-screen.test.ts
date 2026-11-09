import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestConversation } from "@/app/_components/request-conversation";
import type { CommentRecord } from "@/modules/comments";

// SPEC 2026-11-08-atendimento-dia-a-dia, 7.3 items 1 and 3 (SF-216).

const action = async (): Promise<never> => {
  throw new Error("not called");
};
const comment = (overrides: Partial<CommentRecord>): CommentRecord => ({
  id: "c1",
  requestId: "r1",
  body: "Texto",
  isInternal: true,
  createdAt: new Date("2026-11-09T12:00:00Z"),
  author: { id: "ana", name: "Ana", role: "ATTENDANT" },
  files: [],
  mentions: [],
  ...overrides,
});

describe("mentions in the conversation", () => {
  it("shows who a note mentions, and offers the colleagues to the attendant", () => {
    const html = renderToStaticMarkup(
      createElement(RequestConversation, {
        requestId: "r1",
        comments: [comment({ mentions: ["Bia", "Carla"] }), comment({ id: "c2", isInternal: false, mentions: ["Ninguém"] })],
        canWrite: true,
        allowInternal: true,
        action,
        mentionable: [
          { id: "bia", name: "Bia" },
          { id: "carla", name: "Carla" },
        ],
      }),
    );
    expect(html).toContain("Menciona: Bia, Carla");
    // A public comment never shows mentions.
    expect(html).not.toContain("Menciona: Ninguém");
    expect(html).toContain("Mencionar (só em nota interna, até 5)");
    expect(html).toContain('name="mentionIds" value="bia"');
  });

  it("the requester's conversation has no mentions to choose", () => {
    const html = renderToStaticMarkup(
      createElement(RequestConversation, { requestId: "r1", comments: [], canWrite: true, allowInternal: false, action, mentionable: [{ id: "bia", name: "Bia" }] }),
    );
    expect(html).not.toContain("Mencionar");
  });
});
