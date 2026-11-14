import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsReader } from "@/modules/reports/application/analytics-ports";
import type { ReportSector } from "@/modules/reports/application/ports";
import { timeLoggedSummary, type TimeLoggedRow } from "@/modules/reports/domain/analytics";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getAnalytics, type Analytics } from "@/modules/reports/application/analytics";
import { AnalyticsView, HoursTable, samePeriodHref } from "@/app/_components/analytics-view";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 3 (SF-222; CA-CMP-03 for the hours): "Análises" shows the hours
// logged in the period, in total, by sector and by service, only when there are any.

const now = new Date("2026-11-14T15:00:00.000Z");
const central: ReportSector = { id: "11111111-1111-4111-8111-111111111111", name: "Central", isActive: true };
const archive: ReportSector = { id: "22222222-2222-4222-8222-222222222222", name: "Arquivo", isActive: true };

const row = (overrides: Partial<TimeLoggedRow> = {}): TimeLoggedRow => ({
  sectorId: central.id,
  sectorName: "Central",
  serviceName: "Reparo",
  minutes: 90,
  entries: 2,
  ...overrides,
});

const ROWS = [
  row(),
  row({ serviceName: "Acesso", minutes: 30, entries: 1 }),
  row({ sectorId: archive.id, sectorName: "Arquivo", serviceName: "Reparo", minutes: 240, entries: 3 }),
];

describe("timeLoggedSummary", () => {
  it("adds the totals and orders by hours, then by name", () => {
    expect(timeLoggedSummary(ROWS, true)).toEqual({
      totalMinutes: 360,
      totalEntries: 6,
      bySector: [
        { key: archive.id, label: "Arquivo", minutes: 240, entries: 3 },
        { key: central.id, label: "Central", minutes: 120, entries: 3 },
      ],
      byService: [
        { key: `${archive.id}:Reparo`, label: "Reparo (Arquivo)", minutes: 240, entries: 3 },
        { key: `${central.id}:Reparo`, label: "Reparo (Central)", minutes: 90, entries: 2 },
        { key: `${central.id}:Acesso`, label: "Acesso (Central)", minutes: 30, entries: 1 },
      ],
    });
  });

  it("with one sector, has no sector lines and names services alone, joining the same name", () => {
    const summary = timeLoggedSummary([row(), row({ minutes: 30, entries: 1 }), row({ serviceName: "Acesso", minutes: 120, entries: 1 })], false);
    expect(summary.bySector).toEqual([]);
    expect(summary.byService).toEqual([
      { key: "Acesso", label: "Acesso", minutes: 120, entries: 1 },
      { key: "Reparo", label: "Reparo", minutes: 120, entries: 3 },
    ]);
  });

  it("is zero and empty without entries", () => {
    expect(timeLoggedSummary([], true)).toEqual({ totalMinutes: 0, totalEntries: 0, bySector: [], byService: [] });
  });

  it("leaves out a line without minutes", () => {
    expect(timeLoggedSummary([row({ minutes: 0, entries: 0 })], false).byService).toEqual([]);
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
    timeLogged: vi.fn(async () => ROWS),
    ...overrides,
  } as AnalyticsReader;
}

const actor = (role: string, sectorId: string | null = central.id) => ({ id: `${role.toLowerCase()}-1`, role, sectorId, isActive: true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAnalytics: hours (9.1 item 3)", () => {
  it("reads the period's days for the administrator over the organization, with the sector lines", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const source = reader();
    const result = await getAnalytics({ period: "custom", from: "2026-11-01", to: "2026-11-10" }, source, now);

    expect(source.timeLogged).toHaveBeenCalledWith({ sectorId: null }, { firstDay: "2026-11-01", lastDay: "2026-11-10" });
    expect(result.time.totalMinutes).toBe(360);
    expect(result.time.bySector.map(({ label }) => label)).toEqual(["Arquivo", "Central"]);
  });

  it("reads only the manager's sector, ignoring a sector in the URL, without sector lines", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER"));
    const source = reader({ timeLogged: vi.fn(async () => [row()]) });
    const result = await getAnalytics({ period: "7", sector: archive.id }, source, now);

    expect(source.timeLogged).toHaveBeenCalledWith({ sectorId: central.id }, expect.objectContaining({ lastDay: "2026-11-14" }));
    expect(result.time).toEqual({ totalMinutes: 90, totalEntries: 2, bySector: [], byService: [{ key: "Reparo", label: "Reparo", minutes: 90, entries: 2 }] });
  });

  it("reads nothing for a manager without an active sector", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("MANAGER", null));
    const source = reader();
    const result = await getAnalytics({}, source, now);
    expect(source.timeLogged).not.toHaveBeenCalled();
    expect(result.time.totalMinutes).toBe(0);
  });

  it("a reader without the method (older doubles) means no hours", async () => {
    authorization.requireCurrentActor.mockResolvedValue(actor("ADMIN", null));
    const result = await getAnalytics({}, reader({ timeLogged: undefined }), now);
    expect(result.time).toEqual({ totalMinutes: 0, totalEntries: 0, bySector: [], byService: [] });
  });
});

describe("the hours block of \"Análises\"", () => {
  const base = async (role: "ADMIN" | "MANAGER", rows: TimeLoggedRow[]): Promise<Analytics> => {
    authorization.requireCurrentActor.mockResolvedValue(role === "ADMIN" ? actor("ADMIN", null) : actor("MANAGER"));
    return getAnalytics({ period: "30" }, reader({ timeLogged: vi.fn(async () => rows) }), now);
  };
  const render = (analytics: Analytics, timeReport?: { action: string; hidden?: Record<string, string> }) =>
    renderToStaticMarkup(createElement(AnalyticsView, { analytics, action: "/admin", timeReport }));

  it("shows the total, the sectors and the services, with a link to the time report of the same period", async () => {
    const html = render(await base("ADMIN", ROWS), { action: "/admin", hidden: { section: "time" } });
    expect(html).toContain("Horas apontadas");
    expect(html).toContain("Total: 6h em 6 lançamentos");
    expect(html).toContain("<caption>Horas por setor</caption>");
    expect(html).toContain("Reparo (Arquivo)");
    expect(html).toContain('href="/admin?section=time&amp;period=30"');
    // The link is to the report, never to a request.
    expect(html).not.toContain("/requests/");
  });

  it("does not show the block without hours", async () => {
    const html = render(await base("ADMIN", []), { action: "/admin", hidden: { section: "time" } });
    expect(html).not.toContain("Horas apontadas");
    expect(html).not.toContain("relatório de horas");
  });

  it("the manager sees services without sector lines, and the link carries no sector", async () => {
    const html = render(await base("MANAGER", [row({ minutes: 61, entries: 1 })]), { action: "/approvals/time" });
    expect(html).toContain("Total: 1h 1min em 1 lançamento");
    expect(html).not.toContain("Horas por setor");
    expect(html).toContain('href="/approvals/time?period=30"');
  });

  it("without the time report's address, shows the block without the link", async () => {
    const html = render(await base("MANAGER", [row()]));
    expect(html).toContain("Horas apontadas");
    expect(html).not.toContain("href=");
  });
});

describe("shared pieces", () => {
  it("the hours table shows hours and minutes and the number of entries", () => {
    const html = renderToStaticMarkup(createElement(HoursTable, { caption: "Horas por serviço", label: "Serviço", groups: [{ key: "a", label: "Reparo", minutes: 135, entries: 3 }] }));
    expect(html).toContain("<th scope=\"col\">Lançamentos</th>");
    expect(html).toContain("<td>2h 15min</td><td>3</td>");
  });

  it("the same-period link keeps a custom period's days and the sector", () => {
    const period = { option: "custom", firstDay: "2026-11-01", lastDay: "2026-11-10" } as Analytics["period"];
    expect(samePeriodHref({ action: "/admin", hidden: { section: "time" } }, period, central.id)).toBe(
      `/admin?section=time&period=custom&from=2026-11-01&to=2026-11-10&sector=${central.id}`,
    );
  });
});
