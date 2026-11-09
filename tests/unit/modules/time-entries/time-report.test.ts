import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildTimeCsv, buildTimeCsvRows, buildTimeReport, decimalHours, groupTime, timeCsvFileName } from "@/modules/time-entries/application/time-report";
import type { TimeReportReader, TimeReportScope, TimeSumRow } from "@/modules/time-entries/application/time-report";
import { TimeReportView, timeCsvHref } from "@/app/_components/time-report-view";
import { MyTimeView } from "@/app/_components/my-time-view";
import { summarizeMyTime } from "@/modules/time-entries/application/my-time";
import { csvField, lastDaysPeriod } from "@/modules/reports";
import { ValidationError } from "@/server/errors";
import { parseEstimatedHours } from "@/modules/services/domain/sla-config";

// SPEC 2026-11-08-atendimento-dia-a-dia, 5.1 item 3 and 5.3 item 4 (SF-209).

const period = lastDaysPeriod(30, new Date("2026-11-20T15:00:00Z"));
const rows: TimeSumRow[] = [
  { userId: "ana", userName: "Ana", serviceName: "Instalação", sectorId: "ti", sectorName: "TI", minutes: 90, entries: 2 },
  { userId: "ana", userName: "Ana", serviceName: "Rede", sectorId: "ti", sectorName: "TI", minutes: 30, entries: 1 },
  { userId: "bia", userName: "Bia", serviceName: "Instalação", sectorId: "ti", sectorName: "TI", minutes: 150, entries: 3 },
  { userId: "rui", userName: "Rui", serviceName: "Férias", sectorId: "rh", sectorName: "RH", minutes: 60, entries: 1 },
];
const reader = (sums: TimeSumRow[], entries = 0): TimeReportReader => ({
  sums: async () => sums,
  entries: async (_scope, _period, limit) =>
    Array.from({ length: Math.min(entries, limit) }, (_, index) => ({
      workedOn: "2026-11-12",
      userName: "Ana",
      sectorName: "TI",
      serviceName: "Instalação",
      requestId: `0000000${index}-0000-4000-8000-000000000000`,
      minutes: 90,
    })),
});
const organization: TimeReportScope = { audience: "organization", sectors: [], scope: { sectorId: null }, sector: null, sectorError: null };

describe("the time report (5.3 item 4)", () => {
  it("sums by attendant, service and sector, most hours first", async () => {
    const report = await buildTimeReport(organization, { period, error: null }, reader(rows));
    expect(report.totalMinutes).toBe(330);
    expect(report.byAttendant.map(({ label, minutes }) => [label, minutes])).toEqual([
      ["Bia (TI)", 150],
      ["Ana (TI)", 120],
      ["Rui (RH)", 60],
    ]);
    expect(report.bySector.map(({ label, minutes, entries }) => [label, minutes, entries])).toEqual([
      ["TI", 270, 6],
      ["RH", 60, 1],
    ]);
  });

  it("one sector's report names people and services without the sector", async () => {
    const sector: TimeReportScope = { audience: "sector", sectors: [], scope: { sectorId: "ti" }, sector: { id: "ti", name: "TI" }, sectorError: null };
    const report = await buildTimeReport(sector, { period, error: null }, reader(rows.slice(0, 3)));
    expect(report.byService.map(({ label }) => label)).toEqual(["Instalação", "Rede"]);
  });

  it("nothing for a manager without an active sector", async () => {
    const report = await buildTimeReport({ audience: "sector", sectors: [], scope: null, sector: null, sectorError: null }, { period, error: null }, reader(rows));
    expect(report).toMatchObject({ withoutSector: true, totalMinutes: 0, byAttendant: [] });
  });

  it("groups by any key", () => {
    expect(groupTime(rows, (row) => row.serviceName, (row) => row.serviceName)[0]).toEqual({ key: "Instalação", label: "Instalação", minutes: 240, entries: 5 });
  });
});

describe("the CSV of the entries (5.3 item 4)", () => {
  it("has fixed columns, the short code and no description", async () => {
    const csvRows = await buildTimeCsvRows(organization, { period, error: null }, reader([], 1));
    const csv = buildTimeCsv(csvRows, csvField);
    expect(csv.startsWith("﻿Dia;Atendente;Setor;Serviço;Solicitação;Minutos;Horas\r\n")).toBe(true);
    expect(csv).toContain("2026-11-12;Ana;TI;Instalação;00000000;90;1,50\r\n");
    expect(decimalHours(45)).toBe("0,75");
    expect(timeCsvFileName(period)).toBe(`serviceflow-horas-${period.firstDay}-a-${period.lastDay}.csv`);
  });

  it("refuses an invalid period or sector and more than 10,000 rows", async () => {
    await expect(buildTimeCsvRows(organization, { period, error: "too_long" }, reader([]))).rejects.toBeInstanceOf(ValidationError);
    await expect(buildTimeCsvRows({ ...organization, sectorError: "invalid_sector" }, { period, error: null }, reader([]))).rejects.toBeInstanceOf(ValidationError);
    await expect(buildTimeCsvRows(organization, { period, error: null }, reader([], 10_001))).rejects.toMatchObject({ issues: [{ code: "too_big" }] });
  });
});

describe("the report's screen", () => {
  it("shows the totals and a CSV link with the same period and sector", async () => {
    const report = await buildTimeReport(
      { ...organization, sectors: [{ id: "ti", name: "TI", isActive: true }], sector: { id: "ti", name: "TI" } },
      { period: { ...period, option: "custom" }, error: null },
      reader(rows.slice(0, 3)),
    );
    const html = renderToStaticMarkup(createElement(TimeReportView, { action: "/admin", hidden: { section: "time" }, report }));
    expect(html).toContain("Total: 4h 30min");
    expect(html).toContain("Horas por atendente");
    expect(html).not.toContain("Horas por setor");
    expect(timeCsvHref(report)).toBe(`/api/reports/hours.csv?period=custom&from=${period.firstDay}&to=${period.lastDay}&sector=ti`);
  });

  it("says when nothing was logged", async () => {
    const report = await buildTimeReport(organization, { period, error: null }, reader([]));
    expect(renderToStaticMarkup(createElement(TimeReportView, { action: "/admin", report }))).toContain("Nenhuma hora lançada no período.");
  });
});

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 item 1 (SF-227; decision J4).
describe("the estimate on the screens", () => {
  it("compares the average logged on completed requests with each service's estimate", async () => {
    const withEstimates: TimeReportReader = {
      ...reader(rows.slice(0, 1)),
      estimates: async () => [
        { serviceId: "s2", serviceName: "Rede", estimatedHours: null, completed: 1, averageMinutes: 45 },
        { serviceId: "s1", serviceName: "Instalação", estimatedHours: 4, completed: 3, averageMinutes: 200 },
      ],
    };
    const report = await buildTimeReport(organization, { period, error: null }, withEstimates);
    expect(report.estimates.map(({ serviceName }) => serviceName)).toEqual(["Instalação", "Rede"]);
    const html = renderToStaticMarkup(createElement(TimeReportView, { action: "/admin", report }));
    expect(html).toContain("Média apontada contra a estimativa");
    expect(html).toContain("<td>3h 20min</td><td>4h</td>");
    expect(html).toContain("<td>45min</td><td>—</td>");
  });

  it("parses the service's estimate as the base SLA: whole hours from 1 to 200, empty for none", () => {
    expect(parseEstimatedHours("4")).toBe(4);
    expect(parseEstimatedHours(" ")).toBeNull();
    expect(parseEstimatedHours(null)).toBeNull();
    for (const value of ["0", "201", "1.5", -1]) expect(() => parseEstimatedHours(value)).toThrow(ValidationError);
  });
});

// SPEC 2026-11-08-atendimento-dia-a-dia, 13.2 items 2 and 3 (SF-228; decision J5).
describe("hours by tag and the attendant's own hours", () => {
  it("the report sums by tag, with the sector over every sector", async () => {
    const withTags: TimeReportReader = {
      ...reader(rows),
      tagSums: async () => [
        { tagId: "t1", tagName: "Rede", sectorName: "TI", minutes: 30, entries: 1 },
        { tagId: "t2", tagName: "Urgente", sectorName: "TI", minutes: 120, entries: 2 },
      ],
    };
    const report = await buildTimeReport(organization, { period, error: null }, withTags);
    expect(report.byTag.map(({ label, minutes }) => [label, minutes])).toEqual([
      ["Urgente (TI)", 120],
      ["Rede (TI)", 30],
    ]);
    expect(renderToStaticMarkup(createElement(TimeReportView, { action: "/admin", report }))).toContain("Horas por etiqueta");
    // Without tags, no table.
    const plain = await buildTimeReport(organization, { period, error: null }, reader(rows));
    expect(renderToStaticMarkup(createElement(TimeReportView, { action: "/admin", report: plain }))).not.toContain("Horas por etiqueta");
  });

  it("'Minhas horas' adds by day, most recent first, and by service, most hours first", () => {
    const time = summarizeMyTime([
      { workedOn: "2026-11-11", serviceName: "Rede", minutes: 30, entries: 1 },
      { workedOn: "2026-11-12", serviceName: "Instalação", minutes: 90, entries: 2 },
      { workedOn: "2026-11-11", serviceName: "Instalação", minutes: 60, entries: 1 },
    ]);
    expect(time.totalMinutes).toBe(180);
    expect(time.byDay).toEqual([
      { day: "2026-11-12", minutes: 90 },
      { day: "2026-11-11", minutes: 90 },
    ]);
    expect(time.byService).toEqual([
      { label: "Instalação", minutes: 150, entries: 3 },
      { label: "Rede", minutes: 30, entries: 1 },
    ]);
    const html = renderToStaticMarkup(createElement(MyTimeView, { time, period: { firstDay: "2026-11-01", lastDay: "2026-11-12" } }));
    expect(html).toContain("Total: 3h");
    expect(html).toContain("Minhas horas por dia");
    expect(html).toContain("<td>12/11/2026</td><td>1h 30min</td>");
    expect(renderToStaticMarkup(createElement(MyTimeView, { time: summarizeMyTime([]), period: { firstDay: "2026-11-01", lastDay: "2026-11-12" } }))).toContain(
      "Nenhuma hora lançada no período.",
    );
  });
});
