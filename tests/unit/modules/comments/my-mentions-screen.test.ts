import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MyMentionsList } from "@/app/_components/my-mentions";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.4 item 1 (SF-231).

const action = async (): Promise<never> => {
  throw new Error("not called");
};

describe("\"Minhas menções\"", () => {
  it("lists each mention with who, when, whether new, and a button to open it", () => {
    const html = renderToStaticMarkup(
      createElement(MyMentionsList, {
        openAction: action,
        mentions: [
          { commentId: "c2", requestId: "r2", serviceName: "Rede", authorName: "Ana", createdAt: new Date("2026-11-09T13:00:00Z"), seenAt: null },
          { commentId: "c1", requestId: "r1", serviceName: "Teclado", authorName: "Bia", createdAt: new Date("2026-11-09T12:00:00Z"), seenAt: new Date("2026-11-09T12:30:00Z") },
        ],
      }),
    );
    expect(html).toContain("Ana mencionou você");
    expect(html).toContain(">Nova<");
    expect(html).toContain(" · vista");
    expect(html).toContain("Abrir a menção em Rede");
    expect(html).toContain('type="hidden" name="commentId" value="c1"');
  });

  it("says when there are none, and when a mention is no longer reachable", () => {
    expect(renderToStaticMarkup(createElement(MyMentionsList, { openAction: action, mentions: [] }))).toContain("Nenhuma menção.");
    expect(renderToStaticMarkup(createElement(MyMentionsList, { openAction: action, mentions: [], error: "missing" }))).toContain(
      "A menção não está mais disponível para você.",
    );
  });
});
