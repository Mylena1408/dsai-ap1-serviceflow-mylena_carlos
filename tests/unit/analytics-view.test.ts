import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsView, AttendantDashboardView, TEAM_NOTICE } from "@/app/_components/analytics-view";
import { arrivalGrid, lastDaysPeriod, type Analytics, type AttendantDashboard } from "@/modules/reports";

// SPEC 2026-11-06-analises-operacionais, 5.3 to 5.7 (SF-147 and SF-148; CA-ANL-02, 03, 08 to 10).

const now = new Date("2026-11-06T15:00:00.000Z");
const period = lastDaysPeriod(7, now);

const attendant: AttendantDashboard = {
  withoutSector: false,
  sectorName: "Central de Serviços",
  period,
  periodError: null,
  queue: {
    unassigned: 3,
    mine: 2,
    dueSoon: 1,
    overdue: 4,
    paused: 0,
    byPriority: [
      { label: "Urgente", count: 1 },
      { label: "Normal", count: 4 },
    ],
    byStage: [{ label: "Triagem", count: 2 }],
  },
  mine: { completed: 5, completion: { averageHours: 6.5, medianHours: 4 }, onTimePercentage: 80, replies: 9 },
  sector: { completed: 12, completion: { averageHours: 8, medianHours: 5 }, onTimePercentage: 75, replies: 30 },
};

const analytics: Analytics = {
  audience: "organization",
  sectors: [
    { id: "s1", name: "Central", isActive: true },
    { id: "s2", name: "Arquivo", isActive: false },
  ],
  sector: null,
  withoutSector: false,
  period,
  errors: { period: null, sector: null },
  granularity: "day",
  trend: [
    { label: "05/11", firstDay: "2026-11-05", lastDay: "2026-11-05", opened: 3, completed: 1, pendingAtEnd: 6, withDueDate: 1, onTimePercentage: 100 },
    { label: "06/11", firstDay: "2026-11-06", lastDay: "2026-11-06", opened: 1, completed: 0, pendingAtEnd: 7, withDueDate: 0, onTimePercentage: null },
  ],
  sla: {
    firstResponse: { times: { averageHours: 1.5, medianHours: 1 }, answered: 4, unanswered: 2 },
    stages: [{ serviceName: "Reparo", stageName: "Triagem", count: 3, times: { averageHours: 2, medianHours: 1.5 } }],
    pauses: { completed: 5, withPause: 1, times: { averageHours: 3, medianHours: 3 } },
    onTimeByService: [{ label: "Reparo", withDueDate: 4, onTime: 3, percentage: 75, fewData: false }],
    onTimeByPriority: [{ label: "Urgente", withDueDate: 1, onTime: 0, percentage: 0, fewData: true }],
    arrivals: arrivalGrid([{ isoWeekday: 4, hour: 10, count: 2 }]),
  },
  team: [
    { userId: "a", name: "Ana Souza", isActive: true, sectorName: "Central", completed: 3, completion: { averageHours: 2, medianHours: 2 }, onTimePercentage: 100, pendingNow: 1 },
    { userId: "b", name: "Bruno Lima", isActive: false, sectorName: "Central", completed: 1, completion: null, onTimePercentage: null, pendingNow: 0 },
  ],
  teamShowsSector: true,
};

describe("Meu painel (5.3)", () => {
  const html = renderToStaticMarkup(createElement(AttendantDashboardView, { dashboard: attendant }));

  it("shows the queue now and the attendant's period next to the sector's", () => {
    expect(html).toContain("Fila agora");
    expect(html).toContain("Sem responsável");
    expect(html).toContain("Central de Serviços");
    expect(html).toContain("Concluídas por mim");
    expect(html).toContain("setor: 12");
    expect(html).toContain("6,5 h");
    expect(html).toContain("setor: 75%");
    expect(html).toContain("Respostas que escrevi");
    expect(html).toContain('action="/queue/dashboard"');
  });

  it("sizes the priority bars by the largest count, even when the first priority is empty", () => {
    const zeroFirst = renderToStaticMarkup(
      createElement(AttendantDashboardView, {
        dashboard: {
          ...attendant,
          queue: {
            ...attendant.queue,
            byPriority: [
              { label: "Urgente", count: 0 },
              { label: "Normal", count: 7 },
            ],
          },
        },
      }),
    );
    expect(zeroFirst).toContain("width:100%");
    expect(zeroFirst).toContain("width:0%");
  });

  it("never names colleagues nor links to requests", () => {
    expect(html).not.toContain("/requests/");
    expect(html).not.toContain("/queue/0");
    expect(html).not.toContain("Desempenho da equipe");
  });

  it("shows the notice without an active sector", () => {
    const empty = renderToStaticMarkup(createElement(AttendantDashboardView, { dashboard: { ...attendant, withoutSector: true, sectorName: null } }));
    expect(empty).toContain("Você não está ligado a um setor ativo");
  });

  it("explains a refused period", () => {
    const refused = renderToStaticMarkup(createElement(AttendantDashboardView, { dashboard: { ...attendant, periodError: "too_long" } }));
    expect(refused).toContain("O intervalo pode ter no máximo 366 dias. Mostrando os últimos 30 dias.");
  });
});

describe("Análises (5.4 to 5.6)", () => {
  const html = renderToStaticMarkup(createElement(AnalyticsView, { analytics, action: "/admin", hidden: { section: "analytics" } }));

  it("shows the three blocks with charts and tables", () => {
    expect(html).toContain("Tendências");
    expect(html).toContain("Abertas e concluídas");
    expect(html).toContain("Pendentes ao fim de cada intervalo");
    expect(html).toContain("Concluídas no prazo (%)");
    expect(html).toContain("SLA e tempos");
    expect(html).toContain("Reparo · Triagem");
    expect(html).toContain("2 ainda sem resposta");
    expect(html).toContain("1 de 5");
    expect(html).toContain("Quando as solicitações chegam");
    expect(html.match(/Ver os números em tabela/g)).toHaveLength(3);
    expect(html).toContain('name="section" value="analytics"');
  });

  it("shows the team alphabetically with the fixed notice, the inactive mark and the sector column", () => {
    expect(html).toContain(TEAM_NOTICE);
    expect(html.indexOf("Ana Souza")).toBeLessThan(html.indexOf("Bruno Lima"));
    expect(html).toContain("Bruno Lima (inativa)");
    expect(html).toContain("<th scope=\"col\">Setor</th>");
  });

  it("offers the sector filter only to the administrator", () => {
    expect(html).toContain("Arquivo (inativo)");
    const manager = renderToStaticMarkup(
      createElement(AnalyticsView, {
        analytics: { ...analytics, audience: "sector", sectors: [], sector: { id: "s1", name: "Central" }, teamShowsSector: false },
        action: "/approvals/analytics",
      }),
    );
    expect(manager).not.toContain('name="sector"');
    expect(manager).not.toContain("<th scope=\"col\">Setor</th>");
    expect(manager).toContain("Central");
  });

  it("uses weeks in the note for long periods and never links to a request", () => {
    const weekly = renderToStaticMarkup(createElement(AnalyticsView, { analytics: { ...analytics, granularity: "week" }, action: "/admin" }));
    expect(weekly).toContain("Por semana (segunda a domingo).");
    expect(html).not.toContain("href=");
  });
});
