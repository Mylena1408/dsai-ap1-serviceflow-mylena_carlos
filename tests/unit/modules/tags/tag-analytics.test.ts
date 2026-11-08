import { describe, expect, it } from "vitest";
import { tagCounts } from "@/modules/reports/application/analytics";

// SPEC 2026-11-08-atendimento-dia-a-dia, 3.1 item 4 (SF-198; CA-ETQ-04 by the rule).

describe("requests per tag", () => {
  it("most used first, then by name; the sector named only when every sector is shown; none without requests", () => {
    const rows = [
      { name: "Urgente", sectorName: "TI", count: 1 },
      { name: "Rede", sectorName: "TI", count: 3 },
      { name: "Folha", sectorName: "RH", count: 1 },
      { name: "Antiga", sectorName: "TI", count: 0 },
    ];
    expect(tagCounts(rows, false)).toEqual([
      { label: "Rede", count: 3 },
      { label: "Folha", count: 1 },
      { label: "Urgente", count: 1 },
    ]);
    expect(tagCounts(rows, true).map(({ label }) => label)).toEqual(["Rede (TI)", "Folha (RH)", "Urgente (TI)"]);
    expect(tagCounts([], true)).toEqual([]);
  });
});
