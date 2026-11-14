import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsReader } from "@/modules/reports/application/analytics-ports";
import type { ReportSector } from "@/modules/reports/application/ports";
import { MAX_SKIPPED_CHECKLIST_ITEMS, checklistCompletionSummary, type ChecklistCompletionRows } from "@/modules/reports/domain/analytics";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getAnalytics, type Analytics } from "@/modules/reports/application/analytics";
import { AnalyticsView } from "@/app/_components/analytics-view";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3 (SF-223; CA-CMP-03 for the checklist): "Análises" shows, for the
// requests completed in the period that have a checklist, how many had it complete and the optional items most
// left unmarked, only when there are any.

const now = new Date("2026-11-14T15:00:00.000Z");
const central: ReportSector = { id: "11111111-1111-4111-8111-111111111111", name: "Central", isActive: true };
const archive: ReportSector = { id: "22222222-2222-4222-8222-222222222222", name: "Arquivo", isActive: true };

const skipped = (text: string, count: number, sector: ReportSector = central, serviceName = "Reparo") => ({
  sectorId: sector.id,
  sectorName: sector.name,
  serviceName,
  text,
  count,
});

const ROWS: ChecklistCompletionRows = {
  withChecklist: 8,
  complete: 5,
  skipped: [skipped("Avisar o usuário", 2), skipped("Fotografar", 3), skipped("Avisar o usuário", 1, archive, "Mudança")],
};

describe("checklistCompletionSummary", () => {
  it("gives the complete share and the optional items most skipped, then by name", () => {
    expect(checklistCompletionSummary(ROWS, false)).toEqual({
      withChecklist: 8,
      complete: 5,
      completePercentage: 63,
      skippedOptional: [
        { key: `${central.id}:Reparo:Fotografar`, label: "Fotografar · Reparo", count: 3 },
        { key: `${central.id}:Reparo:Avisar o usuário`, label: "Avisar o usuário · Reparo", count: 2 },
        { key: `${archive.id}:Mudança:Avisar o usuário`, label: "Avisar o usuário · Mudança", count: 1 },
      ],
    });
  });

  it("names the sector when every sector is shown", () => {
    expect(checklistCompletionSummary(ROWS, true).skippedOptional.map(({ label }) => label)).toEqual([
      "Fotografar · Reparo (Central)",
      "Avisar o usuário · Reparo (Central)",
      "Avisar o usuário · Mudança (Arquivo)",
    ]);
  });

  it("keeps at most the ten most skipped", () => {
    const many = Array.from({ length: 13 }, (_, index) => skipped(`Item ${String(index).padStart(2, "0")}`, index + 1));
    const summary = checklistCompletionSummary({ withChecklist: 20, complete: 0, skipped: many }, false);
    expect(summary.skippedOptional).toHaveLength(MAX_SKIPPED_CHECKLIST_ITEMS);
    expect(summary.skippedOptional[0]).toMatchObject({ label: "Item 12 · Reparo", count: 13 });
    expect(summary.skippedOptional.at(-1)).toMatchObject({ label: "Item 03 · Reparo", count: 4 });
  });

  it("has no percentage without requests with a checklist, and 100 when every one is complete", () => {
    expect(checklistCompletionSummary({ withChecklist: 0, complete: 0, skipped: [] }, false).completePercentage).toBeNull();
    expect(checklistCompletionSummary({ withChecklist: 3, complete: 3, skipped: [] }, false)).toMatchObject({ completePercentage: 100, skippedOptional: [] });
  });
});

function reader(overrides: Partial<AnalyticsReader> = {}): AnalyticsReader {
  const none = vi.fn(async () => []);
  return {
    findSector: vi.fn(async (id: string) => [central, archive].find((sector) => sector.id === id) ?? null),
    listSectors: vi.fn(async () => [archive, central]),
    attendantQueue: vi.fn(),
    attendantWork: vi.fn(),
    dailyCounts: none,
    pendingAt: vi.fn(async (_scope, instants: readonly Date[]) => instants.map(() => 0)),
    firstResponse: vi.fn(async () => ({ answered: { count: 0, averageMs: null, medianMs: null }, unanswered: 0 })),
    stageTimes: none,
    pauses: vi.fn(async () => ({ completed: 0, paused: { count: 0, averageMs: null, medianMs: null } })),
    onTimeByService: none,
    onTimeByPriority: none,
    arrivals: none,
    team: none,
    escalations: vi.fn(async () => 0),
    satisfaction: vi.fn(async () => ({ distribution: [], completed: 0, ratedCompletions: 0, byService: [] })),
    checklistCompletion: vi.fn(async () => ROWS),
    ...overrides,
  } as AnalyticsReader;
}

const actor = (role: string, sectorId: string | null = central.id) => ({ id: `${role.toLowerCase()}-1`, role, sectorId, isActive: true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAnalytics: checklist (9.1 item 3)", () => {
  it("reads the period's range in the scope of \"Análises\"", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const source = reader();
    const result = await getAnalytics({ period: "7" }, source, now);
    expect(source.checklistCompletion).toHaveBeenCalledWith({ sectorId: null }, { from: result.period.from, before: result.period.before });
    expect(result.checklist).toMatchObject({ withChecklist: 8, complete: 5, completePercentage: 63 });
    expect(result.checklist.skippedOptional[0]!.label).toBe("Fotografar · Reparo (Central)");
  });

  it("gives the manager only the current sector, without the sector in the labels", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER"));
    const source = reader();
    const result = await getAnalytics({ sector: archive.id }, source, now);
    expect(source.checklistCompletion).toHaveBeenCalledWith({ sectorId: central.id }, expect.anything());
    expect(result.checklist.skippedOptional[0]!.label).toBe("Fotografar · Reparo");
  });

  it("reads nothing for a manager without an active sector", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER", null));
    const source = reader();
    const result = await getAnalytics({}, source, now);
    expect(source.checklistCompletion).not.toHaveBeenCalled();
    expect(result.checklist).toEqual({ withChecklist: 0, complete: 0, completePercentage: null, skippedOptional: [] });
  });

  it("a reader without the method (older doubles) means no checklist", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const result = await getAnalytics({}, reader({ checklistCompletion: undefined }), now);
    expect(result.checklist.withChecklist).toBe(0);
  });
});

describe("the checklist block of \"Análises\"", () => {
  const analyticsWith = async (rows: ChecklistCompletionRows): Promise<Analytics> => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER"));
    return getAnalytics({}, reader({ checklistCompletion: vi.fn(async () => rows) }), now);
  };
  const render = (analytics: Analytics) => renderToStaticMarkup(createElement(AnalyticsView, { analytics, action: "/approvals/analytics" }));

  it("shows the complete share and the table of the optional items most skipped", async () => {
    const html = render(await analyticsWith(ROWS));
    expect(html).toContain('<h2 id="analytics-checklist">Checklist</h2>');
    expect(html).toContain("<dt>Checklist completo</dt><dd><strong>63%</strong><span>5 de 8 solicitações</span></dd>");
    expect(html).toContain("Itens opcionais mais deixados sem marcar");
    expect(html).toContain("Fotografar · Reparo");
    expect(html).not.toContain("href=");
  });

  it("says no optional item was skipped instead of an empty table", async () => {
    const html = render(await analyticsWith({ withChecklist: 1, complete: 1, skipped: [] }));
    expect(html).toContain("<span>1 de 1 solicitação</span>");
    expect(html).toContain("Nenhum item opcional ficou sem marcar.");
    expect(html).not.toContain("Itens opcionais mais deixados sem marcar");
  });

  it("does not show the block without completed requests with a checklist", async () => {
    const html = render(await analyticsWith({ withChecklist: 0, complete: 0, skipped: [] }));
    expect(html).not.toContain("analytics-checklist");
    expect(html).not.toContain("Checklist completo");
  });
});
