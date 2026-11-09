import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FollowPreferenceForm } from "@/app/_components/follow-preference";

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.3 item 2 (SF-230; decision J7).

const action = async (): Promise<never> => {
  throw new Error("not called");
};

describe("the follow preference form", () => {
  it("shows the choice as saved, checked by default", () => {
    const on = renderToStaticMarkup(createElement(FollowPreferenceForm, { action, autoFollowOnComment: true, saved: false }));
    expect(on).toContain("Seguir automaticamente as solicitações em que comento");
    expect(on).toContain('checked=""');
    expect(on).not.toContain("Preferência de acompanhamento salva.");
    const off = renderToStaticMarkup(createElement(FollowPreferenceForm, { action, autoFollowOnComment: false, saved: true }));
    expect(off).not.toContain('checked=""');
    expect(off).toContain("Preferência de acompanhamento salva.");
  });
});
