import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Dashboard } from "@/modules/reports";

// The module entry point loads the session; the component only needs the domain rule.
vi.mock("@/modules/reports", async () => {
  const { barPercentage } = await import("@/modules/reports/domain/metrics");
  return { barPercentage };
});

import { DashboardView, dashboardFilterMessages } from "@/app/_components/dashboard-view";
import { lastDaysPeriod } from "@/modules/reports/domain/period";

// SPEC 2026-11-02-painel-relatorios, 5.1 to 5.5 and 5.7 (SF-099; CA-DASH-02, 07 and 09).

const now = new Date("2026-11-02T15:00:00.000Z");

const dashboard: Dashboard = {
  audience: "organization",
  sectors: [
    { id: "s1", name: "Infraestrutura", isActive: true },
    { id: "s2", name: "Arquivo", isActive: false },
  ],
  sector: null,
  withoutSector: false,
  period: lastDaysPeriod(30, now),
  errors: { period: null, sector: null },
  current: { open: 4, awaitingApproval: 1, inProgress: 2, dueSoon: 1, overdue: 3 },
  totals: {
    opened: 6,
    completed: 3,
    cancelled: 1,
    completion: { averageHours: 12.5, medianHours: 4 },
    onTimePercentage: 67,
    byCategory: [
      { label: "Tecnologia", count: 4 },
      { label: "Manutenção", count: 2 },
    ],
    bySector: [{ label: "Infraestrutura", count: 6 }],
    byStatus: [{ label: "Concluída", count: 3 }],
  },
  empty: false,
};

function render(value: Dashboard, hidden?: Record<string, string>) {
  return renderToStaticMarkup(createElement(DashboardView, { dashboard: value, action: "/admin", hidden }));
}

describe("dashboard screen (SF-099)", () => {
  it("shows the indicators, the period and the bars with their numbers", () => {
    const html = render(dashboard, { section: "dashboard" });

    expect(html).toContain('<input type="hidden" name="section" value="dashboard"/>');
    expect(html).toContain("Toda a organização · de 04/10/2026 a 02/11/2026.");
    expect(html).toContain("<dt>Vencidas</dt><dd><strong>3</strong></dd>");
    expect(html).toContain("<strong>12,5 h</strong><span>média · mediana 4 h</span>");
    expect(html).toContain("<strong>67%</strong>");
    expect(html).toContain('<th scope="row">Manutenção</th><td><span class="dashboard-bar" aria-hidden="true"><span style="width:50%"></span></span><span class="dashboard-bar-value">2</span>');
    expect(html).toContain("Por setor");
    expect(html).toContain('<option value="s2">Arquivo (inativo)</option>');
  });

  it("has no link to any request (CA-DASH-09)", () => {
    expect(render(dashboard)).not.toContain("<a ");
  });

  it("shows dashes, the empty message and no sector groups when there is nothing to count", () => {
    const html = render({
      ...dashboard,
      audience: "sector",
      sectors: [],
      sector: { id: "s1", name: "Infraestrutura" },
      empty: true,
      totals: { ...dashboard.totals, completion: null, onTimePercentage: null, bySector: null, byCategory: [], byStatus: [] },
    });

    expect(html).toContain("Nenhuma solicitação no período.");
    expect(html).toContain("<strong>—</strong><span>sem prazo definido</span>");
    expect(html).not.toContain("Por setor");
    expect(html).not.toContain('name="sector"');
    expect(html).toContain("Infraestrutura · de");
  });

  it("tells a manager without an active sector why there are no numbers (CA-DASH-02)", () => {
    expect(render({ ...dashboard, audience: "sector", sectors: [], withoutSector: true })).toContain(
      "Você não está ligado a um setor ativo",
    );
  });

  it("keeps a chosen range in the date fields", () => {
    const html = render({
      ...dashboard,
      period: { ...dashboard.period, option: "custom", firstDay: "2026-10-01", lastDay: "2026-10-31" },
    });

    expect(html).toContain('<option value="custom" selected="">Intervalo de datas</option>');
    expect(html).toContain('type="date" name="from" value="2026-10-01"');
  });
});

describe("messages of refused filters (CA-DASH-07)", () => {
  it("explains each refusal and says what is shown instead", () => {
    expect(dashboardFilterMessages({ period: "too_long", sector: null })).toEqual([
      "O intervalo pode ter no máximo 366 dias. Mostrando os últimos 30 dias.",
    ]);
    expect(dashboardFilterMessages({ period: "inverted_range", sector: "invalid_sector" })).toEqual([
      "A data de início precisa ser anterior ou igual à de fim. Mostrando os últimos 30 dias.",
      "Setor não encontrado. Mostrando toda a organização.",
    ]);
    expect(dashboardFilterMessages({ period: null, sector: null })).toEqual([]);
  });
});
