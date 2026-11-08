import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { SectorTagsPanel, TagChip, sectorTagMessage } from "@/app/_components/sector-tags";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.3 item 1 (SF-195; CA-ETQ-02 through the screen).

describe("the sectors' tags screen", () => {
  it("lists each sector's tags with their color, state and use, and the forms to create and change them", () => {
    const html = renderToStaticMarkup(
      createElement(SectorTagsPanel, {
        area: "admin",
        sectors: [
          {
            sector: { id: "s1", name: "TI" },
            tags: [
              { id: "t1", sectorId: "s1", name: "Rede", color: "blue", isActive: true, inUse: 3 },
              { id: "t2", sectorId: "s1", name: "Antiga", color: "red", isActive: false, inUse: 1 },
            ],
          },
          { sector: { id: "s2", name: "RH" }, tags: [] },
        ],
      }),
    );
    expect(html).toContain("Etiquetas de TI");
    expect(html).toContain("3 solicitações");
    expect(html).toContain("1 solicitação<");
    expect(html).toContain("Inativa");
    expect(html).toContain("background-color:#DBEAFE;color:#1E40AF");
    // An inactive tag is shown in gray.
    expect(html).toContain("background-color:#E5E7EB;color:#1F2937");
    expect(html).toContain("Nova etiqueta de RH");
    expect(html).toContain("Nenhuma etiqueta.");
    expect(html).toContain(">Reativar<");
    expect(html).toContain('value="admin"');
  });

  it("explains each result", () => {
    expect(sectorTagMessage("tag-created")).toEqual({ text: "Etiqueta criada.", error: false });
    expect(sectorTagMessage("tag-taken")?.error).toBe(true);
    expect(sectorTagMessage(undefined)).toBeNull();
    expect(renderToStaticMarkup(createElement(TagChip, { name: "Rede", color: "green" }))).toContain(">Rede<");
  });
});
