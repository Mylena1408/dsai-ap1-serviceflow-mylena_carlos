import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_BAR_WIDTH,
  PLOT,
  axisTicks,
  bandCenter,
  barWidth,
  columnPath,
  labelIndexes,
  linePath,
  lineRuns,
  niceMax,
  yOf,
} from "@/app/_components/chart-geometry";
import { ArrivalHeatmap, ColumnPairChart, LineChart, PercentBars } from "@/app/_components/charts";
import { arrivalGrid } from "@/modules/reports";

// SPEC 2026-11-06-analises-operacionais, 5.7 (SF-146; CA-ANL-09).

describe("chart geometry", () => {
  it("makes count axes of four whole, clean steps (never 2.5 for a count)", () => {
    expect([0, 3, 4, 5, 8, 10, 11, 19, 21, 99, 101, 450].map(niceMax)).toEqual([4, 4, 4, 8, 8, 20, 20, 20, 40, 200, 200, 800]);
    for (const largest of [5, 9, 10, 13, 37, 99, 1234]) {
      const max = niceMax(largest);
      expect(max).toBeGreaterThanOrEqual(largest);
      expect(axisTicks(max).every(Number.isInteger)).toBe(true);
    }
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });

  it("maps values from the baseline to the top of the plot", () => {
    expect(yOf(0, 10)).toBe(PLOT.bottom);
    expect(yOf(10, 10)).toBe(PLOT.top);
    expect(yOf(5, 0)).toBe(PLOT.bottom);
  });

  it("caps bars at 24 px and narrows them in crowded charts", () => {
    expect(barWidth(5, 2)).toBe(MAX_BAR_WIDTH);
    expect(barWidth(31, 2)).toBeLessThan(MAX_BAR_WIDTH);
    expect(barWidth(31, 2)).toBeGreaterThan(1);
  });

  it("draws columns square at the baseline with a rounded end, and nothing for zero", () => {
    const path = columnPath(100, 20, 5, 10);
    expect(path.startsWith(`M100,${PLOT.bottom}`)).toBe(true);
    expect(path).toContain("Q");
    expect(path.endsWith("Z")).toBe(true);
    expect(columnPath(100, 20, 0, 10)).toBe("");
    expect(columnPath(100, 20, 3, 0)).toBe("");
  });

  it("breaks a line at empty values instead of drawing them as zero", () => {
    const runs = lineRuns([50, 100, null, null, 25, 75], 100);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.map(({ index }) => index)).toEqual([0, 1]);
    expect(runs[1]!.map(({ value }) => value)).toEqual([25, 75]);
    expect(runs[0]![1]!.y).toBe(PLOT.top);
    expect(lineRuns([null, null], 100)).toEqual([]);
    expect(linePath(runs[0]!)).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
  });

  it("centers bands across the plot", () => {
    expect(bandCenter(0, 1)).toBe(PLOT.left + PLOT.width / 2);
    expect(bandCenter(1, 2)).toBeGreaterThan(bandCenter(0, 2));
  });

  it("prints axis labels that never collide, keeping the first and the last", () => {
    expect(labelIndexes(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const crowded = labelIndexes(31);
    expect(crowded[0]).toBe(0);
    expect(crowded.at(-1)).toBe(30);
    expect(crowded.length).toBeLessThanOrEqual(Math.floor(PLOT.width / 56));
    for (let index = 1; index < crowded.length; index += 1) {
      expect(((crowded[index]! - crowded[index - 1]!) * PLOT.width) / 31).toBeGreaterThanOrEqual(28);
    }
    expect(labelIndexes(0)).toEqual([]);
  });
});

describe("chart components", () => {
  it("renders paired columns with a legend, tooltips and the same numbers in a table", () => {
    const html = renderToStaticMarkup(
      createElement(ColumnPairChart, {
        id: "flow",
        title: "Abertas e concluídas",
        names: ["Abertas", "Concluídas"] as const,
        points: [
          { label: "05/11", first: 3, second: 1 },
          { label: "06/11", first: 0, second: 2 },
        ],
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-labelledby="flow-title"');
    expect(html).toContain("<title>05/11: Abertas 3, Concluídas 1</title>");
    expect(html).toContain('class="chart-legend"');
    expect(html).toContain("<th scope=\"row\">06/11</th><td>0</td><td>2</td>");
    expect(html.match(/class="chart-series-1" d="M/g)).toHaveLength(1);
    expect(html).not.toContain("<script");
  });

  it("renders a line with gaps, labels only the last value and shows dashes in the table", () => {
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        id: "ontime",
        title: "No prazo",
        valueName: "No prazo",
        unit: "%",
        fixedMax: 100,
        points: [
          { label: "01/11", value: 50 },
          { label: "02/11", value: null },
          { label: "03/11", value: 80 },
        ],
      }),
    );
    expect(html.match(/class="chart-line"/g)).toHaveLength(2);
    expect(html.match(/class="chart-dot"/g)).toHaveLength(2);
    expect(html.match(/class="chart-end-label"/g)).toHaveLength(1);
    expect(html).toContain(">80%</text>");
    expect(html).toContain("<td>—</td>");
    expect(html).toContain(">100%</text>");
  });

  it("renders on-time bars with counts and the few-data note", () => {
    const html = renderToStaticMarkup(
      createElement(PercentBars, {
        caption: "No prazo por serviço",
        groups: [
          { label: "Reparo", withDueDate: 5, onTime: 4, percentage: 80, fewData: false },
          { label: "Acesso", withDueDate: 2, onTime: 1, percentage: 50, fewData: true },
        ],
      }),
    );
    expect(html).toContain("80% (4 de 5)");
    expect(html).toContain("poucos dados");
    expect(html).toContain("width:80%");
    expect(renderToStaticMarkup(createElement(PercentBars, { caption: "x", groups: [] }))).toContain("Nenhuma concluída com prazo no período.");
  });

  it("renders the weekday × hour grid with intensity classes and tooltips", () => {
    const html = renderToStaticMarkup(
      createElement(ArrivalHeatmap, {
        grid: arrivalGrid([
          { isoWeekday: 1, hour: 9, count: 4 },
          { isoWeekday: 5, hour: 14, count: 1 },
        ]),
      }),
    );
    expect(html).toContain('title="Seg, 9h: 4"');
    expect(html).toContain('class="heat-5"');
    expect(html).toContain('class="heat-2"');
    expect(html.match(/<tr>/g)?.length).toBe(8);
    expect(renderToStaticMarkup(createElement(ArrivalHeatmap, { grid: arrivalGrid([]) }))).toContain("Nenhuma solicitação aberta no período.");
  });
});
